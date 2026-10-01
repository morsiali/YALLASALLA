export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const bad = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const forbidden = (msg = 'You do not have permission to do this.', code = 'FORBIDDEN') =>
  new AppError(403, code, msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} was not found.`);
export const conflict = (code: string, msg: string, details?: unknown) =>
  new AppError(409, code, msg, details);
export const unprocessable = (code: string, msg: string, details?: unknown) =>
  new AppError(422, code, msg, details);
