import 'express';

declare global {
  namespace Express {
    interface User {
      userId?: string;
      permissions?: string[];
      role?: string;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
