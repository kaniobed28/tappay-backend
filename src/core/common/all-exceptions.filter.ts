import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Catches everything so clients always get a consistent JSON error shape and internal
 * errors never leak stack traces. 5xx are logged with detail; 4xx pass through cleanly.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: unknown = 'Internal server error';
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as { message?: unknown }).message ?? body;
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status}: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }

    res.status(status).json({
      statusCode: status,
      message,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
