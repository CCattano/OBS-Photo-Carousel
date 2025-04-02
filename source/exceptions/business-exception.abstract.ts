export abstract class BusinessExceptionAbstract extends Error {
  public abstract readonly errMsg: string;
  public abstract readonly code: number;
}
