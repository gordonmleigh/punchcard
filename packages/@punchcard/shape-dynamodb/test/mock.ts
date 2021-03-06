import { any, binary, bool, integer, number, optional, Record, string, timestamp, unknown } from '@punchcard/shape';
import { array, map, set } from '@punchcard/shape/lib/collection';

import '../lib';

// tslint:disable: member-access
export class Nested extends Record({
  /**
   * This is a nested string.
   */
  a: string
}) {}

export class MyType extends Record({
  /**
   * Field documentation.
   */
  id: string,

  count: optional(number),
  integer,
  bool,
  ts: timestamp,

  nested: Nested,
  array: array(string),
  complexArray: array(Nested),
  stringSet: set(string),
  numberSet: set(number),
  map: map(string),
  complexMap: map(Nested),

  binaryField: binary,
  binarySet: set(binary),
  anyField: any,
  unknownField: unknown
}) {}
