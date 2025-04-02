import {BusinessExceptionAbstract} from '../business-exception.abstract';

export class SourceDirectoryNotFoundException extends BusinessExceptionAbstract {
  public readonly errMsg: string = 'The image folder path provided does not exist.\nPlease review your settings.';
  public readonly code: number = 404;
}
