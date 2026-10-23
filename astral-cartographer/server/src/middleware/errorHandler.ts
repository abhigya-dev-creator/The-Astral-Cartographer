import type { Request, Response, NextFunction } from 'express';

/** Central error handler: user-facing errors keep their message; internals are never leaked. */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Uploaded file is too large (maximum 50 MB).' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
  if (err?.name === 'UserFacingError' || err?.name === 'MulterError') return res.status(err.status || 400).json({ error: err.message });
  console.error('[Unhandled Error]', err);
  return res.status(500).json({ error: 'Internal server error.' });
}
