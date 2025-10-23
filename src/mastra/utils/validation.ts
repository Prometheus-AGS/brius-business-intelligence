import { z } from 'zod';

/**
 * Common validation schemas used across the application
 */

// Base schemas
export const UUIDSchema = z.string().uuid();
export const TimestampSchema = z.date();
export const NonEmptyStringSchema = z.string().min(1);

// Environment validation schema
export const EnvironmentSchema = z.object({
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('8h'),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_URL: z.string().url(),
  CONTEXT_SESSION_TIMEOUT: z.string().transform(Number).pipe(z.number().positive()),
  CONTEXT_REFRESH_THRESHOLD: z.string().transform(Number).pipe(z.number().positive()),
  CONTEXT_MAX_HISTORY_ENTRIES: z.string().transform(Number).pipe(z.number().positive()),
  CONTEXT_ENABLE_RECOVERY: z.string().transform(val => val === 'true').pipe(z.boolean()),
  CONTEXT_RECOVERY_ATTEMPTS: z.string().transform(Number).pipe(z.number().positive()),
  REACT_COMPONENT_MAX_COMPLEXITY: z.enum(['low', 'medium', 'high']),
  REACT_COMPONENT_CACHE_ENABLED: z.string().transform(val => val === 'true').pipe(z.boolean()),
  REACT_COMPONENT_MAX_DATA_ROWS: z.string().transform(Number).pipe(z.number().positive()),
});

// Validation result types
export type ValidationResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: z.ZodError;
  message: string;
};

/**
 * Generic validation function
 */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    error: result.error,
    message: formatZodError(result.error),
  };
}

/**
 * Format Zod error for human-readable messages
 */
export function formatZodError(error: z.ZodError): string {
  // Handle case where error.errors might be undefined
  if (!error || !error.errors || !Array.isArray(error.errors)) {
    return 'Validation failed: Unknown error';
  }

  const errorMessages = error.errors.map(err => {
    const path = err.path && err.path.length > 0 ? `${err.path.join('.')}: ` : '';
    return `${path}${err.message || 'Unknown validation error'}`;
  });

  return `Validation failed: ${errorMessages.join(', ')}`;
}

/**
 * Validation middleware for Express-like applications
 */
export function createValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return (req: any, res: any, next: any) => {
    const result = validateData(schema, req.body);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: result.message,
        details: result.error.errors,
      });
    }

    req.validatedBody = result.data;
    next();
  };
}

/**
 * Environment validation utility
 */
export function validateEnvironment(): ValidationResult<z.infer<typeof EnvironmentSchema>> {
  return validateData(EnvironmentSchema, process.env);
}