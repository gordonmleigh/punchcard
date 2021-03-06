import { Member, Value, Visitor as ShapeVisitor } from '@punchcard/shape';
import { array, ArrayShape, MapShape, SetShape } from '@punchcard/shape/lib/collection';
import { BinaryShape, bool, BoolShape, DynamicShape, IntegerShape, NothingShape, number, NumberShape, string, StringShape, TimestampShape } from '@punchcard/shape/lib/primitive';
import { RecordShape, RecordType, ShapeOrRecord } from '@punchcard/shape/lib/record';
import { Shape } from '@punchcard/shape/lib/shape';
import { Writer } from './writer';

const Objekt = Object;

// tslint:disable: array-type

export namespace JsonPath {
  export type Tag = typeof Tag;
  export const Tag = Symbol.for('@punchcard/shape-jsonpath.JsonPath.Tag');

  export type Of<T extends ShapeOrRecord> = Shape.Of<T> extends { [Tag]: infer Q } ? Q : never;

  export type Root<T extends RecordType> = Struct<Shape.Of<T>>[Fields];

  export function of<T extends RecordType>(type: T): Root<T> {
    const shape = Shape.of(type);
    const result: any = {};
    for (const [name, member] of Objekt.entries(shape.Members)) {
      result[name] = member.Shape.visit(visitor as any, new Id(member.Shape, `$['${name}']`));
    }
    return result;
  }

  export function compile(node: JsonPath.Node<any>) {
    const writer = new Writer();
    node[Synthesize](writer);
    return writer.toJsonPath();
  }

  export const isNode = (a: any): a is Node => a[NodeType] !== undefined;

  function resolveExpression<T extends StringShape | NumberShape | IntegerShape>(type: T, expression: Expression<T>): ExpressionNode<T> {
    return isNode(expression) ? expression : new Id(type, typeof expression === 'number' ? expression.toString() : `'${expression}'`) as any;
  }

  export type Expression<T extends Shape> = ExpressionNode<T> | Value.Of<T>;

  export const NodeType = Symbol.for('@punchcard/shape-jsonpath.JsonPath.NodeType');
  export const SubNodeType = Symbol.for('@punchcard/shape-jsonpath.JsonPath.SubNodeType');
  export const DataType = Symbol.for('@punchcard/shape-jsonpath.JsonPath.DataType');
  export const InstanceExpression = Symbol.for('@punchcard/shape-jsonpath.JsonPath.InstanceExpression');
  export const Synthesize = Symbol.for('@punchcard/shape-jsonpath.JsonPath.Synthesize');
  export const ExpressionTag = Symbol.for('@punchcard/shape-jsonpath.JsonPath.ExpressionTag');

  export abstract class Node<T extends string = string> {
    public readonly [NodeType]: T;
    constructor(nodeType: T) {
      this[NodeType] = nodeType;
    }

    public abstract [Synthesize](writer: Writer): void;
  }

  export abstract class StatementNode extends Node<'statement'> {
    public abstract [SubNodeType]: string;
    constructor() {
      super('statement');
    }
  }

  export abstract class ExpressionNode<S extends Shape> extends Node<'expression'> {
    public readonly [DataType]: S;
    public abstract readonly [SubNodeType]: string;

    constructor(shape: S) {
      super('expression');
      this[DataType] = shape;
    }
  }

  export class Id<T extends Shape> extends ExpressionNode<T> {
    public readonly [SubNodeType]: 'identifier' = 'identifier';

    constructor(shape: T, public readonly value: string) {
      super(shape);
    }

    public [Synthesize](writer: Writer): void {
      writer.writeToken(this.value);
    }
  }

  export class Object<T extends Shape = Shape> extends ExpressionNode<T> {
    public readonly [SubNodeType]: 'object' = 'object';

    public readonly [ExpressionTag]: ExpressionNode<T>;

    constructor(shape: T, expression: ExpressionNode<T>) {
      super(shape);
      this[ExpressionTag] = expression;
    }

    public [Synthesize](writer: Writer): void {
      this[ExpressionTag][Synthesize](writer);
    }
  }
  export namespace Object {
    export abstract class Comparison<T extends Shape, U extends Shape> extends ExpressionNode<BoolShape> {
      protected abstract operator: string;
      constructor(public readonly left: ExpressionNode<T>, public readonly right: ExpressionNode<U>) {
        super(bool);
      }

      public [Synthesize](writer: Writer): void {
        this.left[Synthesize](writer);
        writer.writeToken(this.operator);
        this.right[Synthesize](writer);
      }
    }
    export class Equals<T extends Shape> extends Object.Comparison<T, T> {
      protected readonly operator: '==' = '==';
      public readonly [SubNodeType] = 'equals';
    }
    export class NotEquals<T extends Shape> extends Object.Comparison<T, T> {
      protected readonly operator: '!=' = '!=';
      public readonly [SubNodeType] = 'not-equals';
    }
  }

  export class Dynamic<T extends DynamicShape<any | unknown>> extends Object<T> {
    public as<S extends Shape>(shape: S): JsonPath.Of<S> {
      return shape.visit(visitor as any, this);
    }
  }

  export class Binary extends Object<BinaryShape> {}

  export class Bool extends Object<BoolShape> {
    constructor(expression: ExpressionNode<BoolShape>, boolShape?: BoolShape) {
      super(boolShape || bool, expression);
    }

    public and(...conditions: Bool[]): Bool {
      return new Bool(new Bool.And([this, ...conditions]));
    }

    public or(...conditions: Bool[]): Bool {
      return new Bool(new Bool.Or([this, ...conditions]));
    }

    public not(): Bool {
      return new Bool(new Bool.Not(this), this[DataType]);
    }
  }
  export namespace Bool {
    export abstract class Operands extends ExpressionNode<BoolShape> {
      public abstract readonly operator: string;

      constructor(public readonly operands: ExpressionNode<BoolShape>[]) {
        super(bool);
      }

      public [Synthesize](writer: Writer): void {
        writer.writeToken('(');
        for (const op of this.operands) {
          op[Synthesize](writer);
          writer.writeToken(` ${this.operator} `);
        }
        writer.pop();
        writer.writeToken(')');
      }
    }

    export class And extends Operands {
      public readonly operator = '&&';
      public [SubNodeType] = 'and';
    }
    export class Or extends Operands {
      public readonly operator = '||';
      public [SubNodeType] = 'or';
    }
    export class Not extends ExpressionNode<BoolShape> {
      public [SubNodeType] = 'or';

      constructor(public readonly operand: ExpressionNode<BoolShape>) {
        super(bool);
      }

      public [Synthesize](writer: Writer): void {
        writer.writeToken('(!');
        this.operand[Synthesize](writer);
        writer.writeToken(')');
      }
    }
  }
  export function or(...operands: Bool[]): Bool {
    return new Bool(new Bool.Or(operands));
  }
  export function and(...operands: Bool[]): Bool {
    return new Bool(new Bool.And(operands));
  }
  export function not(operand: ExpressionNode<BoolShape>): Bool {
    return new Bool(new Bool.Not(operand));
  }

  export class Number extends Object<Number.Shape> {
    public greaterThan(other: Expression<Number.Shape>): Bool {
      return new Bool(new Number.Gt(this, resolveExpression(number, other)));
    }
    public greaterThanOrEqual(other: Expression<Number.Shape>): Bool {
      return new Bool(new Number.Gte(this, resolveExpression(number, other)));
    }
    public lessThan(other: Expression<Number.Shape>): Bool {
      return new Bool(new Number.Lt(this, resolveExpression(number, other)));
    }
    public lessThanOrEqual(other: Expression<Number.Shape>): Bool {
      return new Bool(new Number.Lte(this, resolveExpression(number, other)));
    }
    public equals(other: Expression<Number.Shape>): Bool {
      return new Bool(new Object.Equals(this, resolveExpression(number, other as any)));
    }
    public notEquals(other: Expression<Number.Shape>): Bool {
      return new Bool(new Object.NotEquals(this, resolveExpression(number, other as any)));
    }
  }
  export namespace Number {
    export type Shape = NumberShape | IntegerShape;

    export class Gt<T extends Shape> extends Object.Comparison<T, Number.Shape> {
      protected readonly operator: '>' = '>';
      public readonly [SubNodeType] = 'greaterThan';
    }
    export class Gte<T extends Shape> extends Object.Comparison<T, Number.Shape> {
      protected readonly operator: '>=' = '>=';
      public readonly [SubNodeType] = 'greaterThanOrEqual';
    }
    export class Lt<T extends Shape> extends Object.Comparison<T, Number.Shape> {
      protected readonly operator: '<' = '<';
      public readonly [SubNodeType] = 'lessThan';
    }
    export class Lte<T extends Shape> extends Object.Comparison<T, Number.Shape> {
      protected readonly operator: '<=' = '<=';
      public readonly [SubNodeType] = 'lessThanOrEqual';
    }
  }

  export class String extends Object<StringShape> {
    public equals(other: Expression<StringShape>): Bool {
      return new Bool(new Object.Equals(this, resolveExpression(string, other as any)));
    }
    public notEquals(other: Expression<StringShape>): Bool {
      return new Bool(new Object.NotEquals(this, resolveExpression(string, other as any)));
    }
    public match(regex: RegExp): Bool {
      return new Bool(new String.Match(this, regex));
    }
  }

  export namespace String {
    export class Match extends ExpressionNode<BoolShape> {
      public readonly [SubNodeType]: 'string-match' = 'string-match';

      // tslint:disable-next-line: ban-types
      constructor(private readonly string: String, public readonly regex: RegExp) {
        super(bool);
      }

      public [Synthesize](writer: Writer): void {
        this.string[Synthesize](writer);
        writer.writeToken(' =~ ');
        writer.writeToken(this.regex.source);
      }
    }
  }

  export class Filter<T extends Shape> extends ExpressionNode<ArrayShape<T>> {
    public readonly [SubNodeType]: 'filter' = 'filter';

    constructor(private readonly parent: ExpressionNode<any>, public readonly condition: Bool) {
      super(parent[DataType]);
    }

    public [Synthesize](writer: Writer): void {
      this.parent[Synthesize](writer);
      writer.writeToken(`[?(`);
      this.condition[Synthesize](writer);
      writer.writeToken(`)]`);
    }
  }
  export namespace Filter {
    export class Item<T extends Shape> extends ExpressionNode<T> {
      public readonly [SubNodeType]: 'filter-item' = 'filter-item';

      public [Synthesize](writer: Writer): void {
        writer.writeToken('@');
      }
    }
  }

  export type Item = typeof Item;
  export const Item = Symbol.for('@punchcard/shape-jsonpath.JsonPath.Item');

  export class Array<T extends Shape> extends Object<ArrayShape<T>> {
    public readonly [Item]: Of<T>;
    constructor(shape: ArrayShape<T>, expression: ExpressionNode<ArrayShape<T>>) {
      super(shape, expression);
      this[Item] = expression[DataType].Items.visit(visitor as any, new Filter.Item(expression[DataType])) as any;
    }

    public get(key: number): Of<T> {
      return this[DataType].Items.visit(visitor as any, new Array.Get(this, key)) as any;
    }

    public filter(f: (item: Of<T>) => Bool): Array<T> {
      return this[DataType].Items.visit(visitor as any, new Filter(this, f(this[Item]))) as any;
    }
  }
  export namespace Array {
    export class Get<T extends Shape> extends ExpressionNode<T> {
      public readonly [SubNodeType]: 'array-get-value' = 'array-get-value';

      constructor(public readonly array: Array<T>, public readonly key: number) {
        super(array[DataType].Items);
      }

      public [Synthesize](writer: Writer): void {
        this.array[Synthesize](writer);
        writer.writeToken(`[${this.key}]`);
      }
    }
  }

  export class Map<T extends Shape> extends Object<MapShape<T>> {
    public readonly [Item]: Of<T>;
    constructor(shape: MapShape<T>, expression: ExpressionNode<MapShape<T>>) {
      super(shape, expression);
      this[Item] = shape.Items.visit(visitor as any, new Filter.Item(expression[DataType])) as any;
    }

    public get(key: string): Of<T> {
      return this[DataType].Items.visit(visitor as any, new Map.Get(this, key)) as any;
    }

    public filter(f: (item: Of<T>) => Bool): Map<T> {
      return this[DataType].Items.visit(visitor as any, new Filter(this, f(this[Item]))) as any;
    }
  }
  export namespace Map {
    export class Get<T extends Shape> extends ExpressionNode<T> {
      public readonly [SubNodeType]: 'map-get-value' = 'map-get-value';

      constructor(public readonly map: Map<T>, public readonly key: string) {
        super(map[DataType].Items);
      }

      public [Synthesize](writer: Writer): void {
        this.map[Synthesize](writer);
        writer.writeToken(`['${this.key}']`);
      }
    }
  }

  export const Fields = Symbol.for('@punchcard/shape-jsonpath.JsonPath.Fields');
  export type Fields = typeof Fields;
  export class Struct<T extends RecordShape<any, any>> extends Object<T> {
    public readonly [Fields]: {
      [fieldName in keyof T['Members']]: Of<T['Members'][fieldName]['Shape']>;
    };

    constructor(type: T, expression: ExpressionNode<T>) {
      super(type, expression);
      this[Fields] = {} as any;
      for (const [name, prop] of Objekt.entries(type.Members)) {
        Member.assertInstance(prop);
        (this[Fields] as any)[name] = prop.Shape.visit(visitor as any, new Struct.Field(this, prop.Shape, name));
      }
    }
  }
  export namespace Struct {
    export class Field<T extends Shape> extends ExpressionNode<T> {
      public readonly [SubNodeType] = 'struct-field';

      constructor(public readonly struct: Struct<any>, type: T, public readonly name: string) {
        super(type);
      }

      public [Synthesize](writer: Writer): void {
        this.struct[Synthesize](writer);
        writer.writeToken(`['${this.name}']`);
      }
    }
  }
}

class Visitor implements ShapeVisitor<any, JsonPath.ExpressionNode<any>> {
  public nothingShape(shape: NothingShape, expression: JsonPath.ExpressionNode<any>): JsonPath.Object<NothingShape> {
    return new JsonPath.Object(shape, expression);
  }
  public dynamicShape(shape: DynamicShape<any>, expression: JsonPath.ExpressionNode<any>): JsonPath.Dynamic<any> {
    return new JsonPath.Dynamic(shape, expression);
  }
  public binaryShape(shape: BinaryShape, expression: JsonPath.ExpressionNode<any>): JsonPath.Binary {
    return new JsonPath.Binary(shape, expression);
  }
  public arrayShape(shape: ArrayShape<any>, expression: JsonPath.ExpressionNode<any>): JsonPath.Array<any> {
    return new Proxy(new JsonPath.Array(shape, expression), {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          if (!isNaN(prop as any)) {
            return target.get(parseInt(prop, 10));
          }
        } else if (typeof prop === 'number' && prop % 1 === 0) {
          return target.get(prop);
        }
        return (target as any)[prop];
      }
    });
  }
  public boolShape(shape: BoolShape, expression: JsonPath.ExpressionNode<any>): JsonPath.Bool {
    return new JsonPath.Bool(expression, shape);
  }
  public recordShape(shape: RecordShape<any, any>, expression: JsonPath.ExpressionNode<any>): JsonPath.Struct<RecordShape<any, any>> {
    return new Proxy(new JsonPath.Struct(shape, expression), {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          return target[JsonPath.Fields][prop];
        }
        return (target as any)[prop];
      }
    });
  }
  public mapShape(shape: MapShape<any>, expression: JsonPath.ExpressionNode<any>): JsonPath.Map<Shape> {
    return new Proxy(new JsonPath.Map(shape, expression), {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          if (typeof (target as any)[prop] === 'function') {
            return (target as any)[prop];
          }
          return target.get(prop);
        }
        return (target as any)[prop];
      }
    });
  }
  public integerShape(shape: IntegerShape, expression: JsonPath.ExpressionNode<any>): JsonPath.Number {
    return new JsonPath.Number(shape, expression);
  }
  public numberShape(shape: NumberShape, expression: JsonPath.ExpressionNode<any>): JsonPath.Number {
    return new JsonPath.Number(shape, expression);
  }
  public setShape(shape: SetShape<any>, expression: JsonPath.ExpressionNode<any>): JsonPath.Array<Shape> {
    return new JsonPath.Array(array(shape.Items), expression);
  }
  public stringShape(shape: StringShape, expression: JsonPath.ExpressionNode<any>): JsonPath.String {
    return new JsonPath.String(shape, expression);
  }
  public timestampShape(shape: TimestampShape, expression: JsonPath.ExpressionNode<any>): JsonPath.String {
    return new JsonPath.String(string, expression);
  }
}

const visitor = new Visitor();

declare module '@punchcard/shape/lib/shape' {
  export interface Shape {
    [JsonPath.Tag]: unknown;
  }
}
declare module '@punchcard/shape/lib/primitive' {
  export interface BoolShape {
    [JsonPath.Tag]: JsonPath.Bool;
  }
  export interface NumberShape {
    [JsonPath.Tag]: JsonPath.Number;
  }
  export interface StringShape {
    [JsonPath.Tag]: JsonPath.String;
  }
  export interface TimestampShape {
    [JsonPath.Tag]: JsonPath.String;
  }
}

declare module '@punchcard/shape/lib/collection' {
  export interface ArrayShape<T extends Shape> {
    [JsonPath.Tag]: JsonPath.Array<T> & {
      [key: number]: JsonPath.Of<T>;
    };
  }
  export interface SetShape<T extends Shape> {
    [JsonPath.Tag]: JsonPath.Array<T>;
  }
  export interface MapShape<T extends Shape> {
    [JsonPath.Tag]: JsonPath.Map<T> & {
      [key: string]: JsonPath.Of<T>;
    };
  }
}

declare module '@punchcard/shape/lib/record' {
  export interface RecordShape<M extends RecordMembers, I = any> {
    [JsonPath.Tag]: JsonPath.Struct<this> & {
      [fieldName in keyof this['Members']]: JsonPath.Of<this['Members'][fieldName]['Shape']>;
    };
  }
}
