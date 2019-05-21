import events = require('@aws-cdk/aws-events-targets');
import s3 = require('@aws-cdk/aws-s3');
import cdk = require('@aws-cdk/cdk');

import { Function, LambdaExecutorService } from '../../compute';
import { Client } from '../../runtime';
import { RuntimeShape, Shape } from '../../shape';
import { Bucket } from '../s3';
import { Partition, Table } from './table';

/**
 * Properties for creating a Validator.
 */
export interface ValidatorProps<T extends Shape, P extends Partition> {
  /**
   * Bucket from which data is being read.
   */
  sourceBucket: s3.IBucket;

  /**
   * Table that the flowing data belongs to.
   */
  table: Table<T, P>;

  /**
   * Optionally provide an executorService to override the properties
   * of the created Lambda Function.
   *
   * @default executorService with `memorySize: 256` and `timeout: 60`.
   */
  executorService?: LambdaExecutorService;
}

/**
 * Replicates data from one S3 bucket into a Glue Table:
 * * Subscribes to a notification for each object written to S3.
 * * Parses each object and writes semantically partitioned data to the Table.
 */
export class Partitioner<T extends Shape, P extends Partition> extends cdk.Construct {
  public readonly table: Table<T, any>;
  public readonly processor: Function<S3Event, void, {
    source: Client<Bucket.ReadClient>;
    table: Client<Table.WriteClient<T, P>>;
  }>;
  public readonly sourceBucket: s3.IBucket;

  constructor(scope: cdk.Construct, id: string, props: ValidatorProps<T, P>) {
    super(scope, id);
    this.table = props.table;
    const executorService = props.executorService || new LambdaExecutorService({
      memorySize: 1024,
      timeout: 60
    });

    this.sourceBucket = props.sourceBucket;
    this.processor = executorService.run(this, 'Processor', {
      clients: {
        source: new Bucket(this.sourceBucket).readClient(),
        table: this.table.writeClient()
      },
      handle: async (event: S3Event, {source, table}) => {
        // collect the records by downloading, decompressing and parsing each S3 object
        const records = await Promise.all(event.Records.map(async record => {
          const object = await source.getObject({
            Key: record.s3.object.key,
            IfMatch: record.s3.object.eTag
          });

          const results: Array<RuntimeShape<T>> = [];
          if (object.Body) {
            let buf: Buffer;
            if (Buffer.isBuffer(object.Body)) {
              buf = object.Body;
            } else if (typeof object.Body === 'string') {
              buf = new Buffer(object.Body, 'utf8');
            } else {
              throw new Error(`could not read object body with typeof, ${typeof object.Body}`);
            }
            const decompressed = await this.table.compression.decompress(buf);
            for (const buffer of this.table.codec.split(decompressed)) {
              results.push(this.table.mapper.read(buffer));
            }
          }
          return results;
        }));

        await table.write(records.reduce((a, b) => a.concat(b)));
      }
    });
    props.sourceBucket.onPutObject('OnPutObject', new events.LambdaFunction(this.processor), this.table.s3Prefix);
  }
}

export interface S3Event {
  Records: S3Record[];
}

export interface S3Record {
  eventVersion: string,
  eventSource: string,
  awsRegion: string,
  eventTime: string,
  eventName: string,
  requestParameters: RequestParameters,
  responseElements: ResponseElements,
  s3: S3
}

export interface S3 {
  s3SchemaVersion: string,
  configurationId: string,
  bucket: S3Bucket,
  object: S3Object
}

export interface S3Object {
  key: string,
  size: number,
  eTag: string,
  sequencer: string
}

export interface S3Bucket {
  name: string,
  ownerIdentity: UserIdentity,
  arn: string,
}

export interface UserIdentity {
  principalId: string
}

export interface ResponseElements {
  'x-amz-request-id': string,
  'x-amz-id-2': string,
}
export interface RequestParameters {
  sourceIPAddress: string
}