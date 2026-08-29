import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/** Logs each HTTP request with method, path, status and the caller's IP. */
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const ip = req.ip ?? req.socket.remoteAddress;
    const start = Date.now();
    res.on('finish', () => {
      this.logger.log(`${method} ${originalUrl} ${res.statusCode} ${Date.now() - start}ms — ${ip}`);
    });
    next();
  }
}
