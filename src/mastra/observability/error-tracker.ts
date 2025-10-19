/**
 * Comprehensive Error Tracking Service
 * Constitutional requirement: Complete error observability with context capture and analysis
 */

import { getLangFuseClient } from './langfuse-client.js';
import { withErrorHandling } from './error-handling.js';
import { rootLogger } from './logger.js';
import {
  TraceContext,
  TraceError,
  ErrorSeverity,
  ComponentType,
  createTraceError,
  createTraceContext,
} from '../types/observability.js';
import { randomUUID } from 'crypto';

/**
 * Enhanced error context with comprehensive information
 */
export interface EnhancedErrorContext {
  errorId: string;
  component: ComponentType;
  operation: string;
  traceContext: TraceContext;
  userContext?: {
    userId?: string;
    sessionId?: string;
    organizationId?: string;
    userAgent?: string;
    ipAddress?: string;
    location?: string;
  };
  technicalContext?: {
    environment?: 'development' | 'staging' | 'production';
    version?: string;
    buildId?: string;
    nodeVersion?: string;
    platform?: string;
    architecture?: string;
    memoryUsage?: NodeJS.MemoryUsage;
    uptime?: number;
  };
  businessContext?: {
    workflowId?: string;
    agentId?: string;
    toolId?: string;
    operationId?: string;
    businessProcess?: string;
    impactLevel?: 'low' | 'medium' | 'high' | 'critical';
    affectedUsers?: number;
    financialImpact?: number;
  };
  stackTrace?: {
    frames: StackFrame[];
    sourceMap?: boolean;
    truncated?: boolean;
  };
  breadcrumbs?: ErrorBreadcrumb[];
  metadata?: Record<string, any>;
  tags?: string[];
}

/**
 * Stack frame information
 */
export interface StackFrame {
  file: string;
  function: string;
  line: number;
  column: number;
  source?: string;
  context?: {
    pre: string[];
    line: string;
    post: string[];
  };
}

/**
 * Error breadcrumb for tracking the path to an error
 */
export interface ErrorBreadcrumb {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  data?: Record<string, any>;
}

/**
 * Error occurrence with frequency tracking
 */
export interface ErrorOccurrence {
  errorId: string;
  errorSignature: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  contexts: EnhancedErrorContext[];
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
  severity: ErrorSeverity;
  affectedUsers: Set<string>;
  affectedSessions: Set<string>;
}

/**
 * Error analysis result
 */
export interface ErrorAnalysis {
  errorId: string;
  pattern: ErrorPattern;
  rootCause?: string;
  impactAssessment: {
    severity: ErrorSeverity;
    userImpact: number;
    businessImpact: number;
    technicalImpact: number;
  };
  similarErrors: string[];
  recommendations: string[];
  autoResolvable: boolean;
  escalationNeeded: boolean;
}

/**
 * Error pattern classification
 */
export interface ErrorPattern {
  type: 'transient' | 'persistent' | 'cascading' | 'user-induced' | 'system-induced';
  frequency: 'rare' | 'occasional' | 'frequent' | 'constant';
  trend: 'increasing' | 'decreasing' | 'stable' | 'sporadic';
  timePattern?: {
    peakHours?: number[];
    dayOfWeek?: number[];
    seasonal?: boolean;
  };
}

/**
 * Error tracking configuration
 */
export interface ErrorTrackingConfig {
  enabled: boolean;
  captureStackTrace: boolean;
  captureBreadcrumbs: boolean;
  captureContext: boolean;
  captureUserInfo: boolean;
  captureTechnicalInfo: boolean;
  captureBusinessInfo: boolean;
  maxBreadcrumbs: number;
  maxStackFrames: number;
  maxContextSize: number;
  deduplicationWindow: number; // milliseconds
  autoResolution: boolean;
  realTimeAlerts: boolean;
  sensitiveFields: string[];
  retentionDays: number;
}

/**
 * Default error tracking configuration
 */
const defaultErrorTrackingConfig: ErrorTrackingConfig = {
  enabled: true,
  captureStackTrace: true,
  captureBreadcrumbs: true,
  captureContext: true,
  captureUserInfo: true,
  captureTechnicalInfo: true,
  captureBusinessInfo: true,
  maxBreadcrumbs: 50,
  maxStackFrames: 30,
  maxContextSize: 100000, // 100KB
  deduplicationWindow: 60000, // 1 minute
  autoResolution: false,
  realTimeAlerts: true,
  sensitiveFields: [
    'password', 'secret', 'token', 'key', 'credential', 'api_key',
    'auth', 'authorization', 'ssn', 'social_security', 'credit_card',
    'private_key', 'certificate', 'pin', 'account_number', 'email',
    'phone', 'address', 'ip_address'
  ],
  retentionDays: 90,
};

/**
 * Comprehensive Error Tracking Service
 * Constitutional requirement for complete error observability
 */
export class ErrorTracker {
  private langfuseClient = getLangFuseClient();
  private config: ErrorTrackingConfig;
  private errorOccurrences: Map<string, ErrorOccurrence> = new Map();
  private breadcrumbs: ErrorBreadcrumb[] = [];
  private recentErrors: Map<string, Date> = new Map();

  constructor(config: Partial<ErrorTrackingConfig> = {}) {
    this.config = { ...defaultErrorTrackingConfig, ...config };

    // Initialize system monitoring
    this.initializeSystemMonitoring();

    rootLogger.info('Comprehensive error tracker initialized', {
      enabled: this.config.enabled,
      capture_stack_trace: this.config.captureStackTrace,
      capture_breadcrumbs: this.config.captureBreadcrumbs,
      real_time_alerts: this.config.realTimeAlerts,
    });
  }

  /**
   * Initialize system-level error monitoring
   */
  private initializeSystemMonitoring(): void {
    if (!this.config.enabled) return;

    // Capture unhandled exceptions
    process.on('uncaughtException', (error: Error) => {
      this.trackError(error, {
        errorId: randomUUID(),
        component: 'system',
        operation: 'uncaught_exception',
        traceContext: createTraceContext({ traceId: randomUUID() }),
        technicalContext: {
          environment: process.env.NODE_ENV as any,
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime(),
        },
        tags: ['uncaught-exception', 'critical', 'system-level'],
      });
    });

    // Capture unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.trackError(error, {
        errorId: randomUUID(),
        component: 'system',
        operation: 'unhandled_rejection',
        traceContext: createTraceContext({ traceId: randomUUID() }),
        technicalContext: {
          environment: process.env.NODE_ENV as any,
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime(),
        },
        metadata: {
          promise_string: promise.toString(),
          rejection_reason: String(reason),
        },
        tags: ['unhandled-rejection', 'critical', 'system-level'],
      });
    });

    // Add system breadcrumb
    this.addBreadcrumb({
      timestamp: new Date(),
      level: 'info',
      category: 'system',
      message: 'Error tracker initialized',
      data: {
        node_version: process.version,
        platform: process.platform,
        uptime: process.uptime(),
      },
    });
  }

  /**
   * Track an error with comprehensive context capture
   */
  async trackError(error: Error, context: EnhancedErrorContext): Promise<string> {
    if (!this.config.enabled) {
      return context.errorId;
    }

    return await withErrorHandling(
      async () => {
        // Create enhanced error context
        const enhancedContext = await this.enhanceErrorContext(error, context);

        // Generate error signature for deduplication
        const errorSignature = this.generateErrorSignature(error, enhancedContext);

        // Check for deduplication
        if (this.shouldDeduplicate(errorSignature)) {
          await this.updateExistingError(errorSignature, enhancedContext);
          return context.errorId;
        }

        // Create comprehensive trace error
        const traceError = this.createTraceError(error, enhancedContext);

        // Record error occurrence
        await this.recordErrorOccurrence(errorSignature, enhancedContext);

        // Send to LangFuse
        await this.sendErrorToLangFuse(traceError, enhancedContext);

        // Perform error analysis
        const analysis = await this.analyzeError(enhancedContext);

        // Log error with full context
        await this.logErrorWithContext(error, enhancedContext, analysis);

        // Send real-time alerts if configured
        if (this.config.realTimeAlerts && this.shouldAlert(analysis)) {
          await this.sendRealTimeAlert(error, enhancedContext, analysis);
        }

        // Add error breadcrumb
        this.addBreadcrumb({
          timestamp: new Date(),
          level: 'error',
          category: enhancedContext.component,
          message: `Error tracked: ${error.message}`,
          data: {
            error_id: context.errorId,
            component: enhancedContext.component,
            operation: enhancedContext.operation,
            severity: traceError.severity,
          },
        });

        rootLogger.debug('Error tracked with comprehensive context', {
          error_id: context.errorId,
          error_signature: errorSignature,
          component: enhancedContext.component,
          operation: enhancedContext.operation,
          severity: traceError.severity,
          user_id: enhancedContext.userContext?.userId,
        });

        return context.errorId;
      },
      {
        component: 'error_tracker',
        operation: 'track_error',
        metadata: {
          error_id: context.errorId,
          component: context.component,
          operation: context.operation,
        },
      },
      'high'
    );
  }

  /**
   * Enhance error context with additional information
   */
  private async enhanceErrorContext(
    error: Error,
    context: EnhancedErrorContext
  ): Promise<EnhancedErrorContext> {
    const enhanced = { ...context };

    // Capture stack trace if enabled
    if (this.config.captureStackTrace) {
      enhanced.stackTrace = this.parseStackTrace(error);
    }

    // Add current breadcrumbs if enabled
    if (this.config.captureBreadcrumbs) {
      enhanced.breadcrumbs = [...this.breadcrumbs];
    }

    // Enhance technical context
    if (this.config.captureTechnicalInfo) {
      enhanced.technicalContext = {
        ...enhanced.technicalContext,
        environment: process.env.NODE_ENV as any || 'development',
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
      };
    }

    // Add error timing
    enhanced.metadata = {
      ...enhanced.metadata,
      error_timestamp: new Date().toISOString(),
      error_type: error.constructor.name,
      error_name: error.name,
      stack_available: Boolean(error.stack),
      cause_available: Boolean(error.cause),
    };

    // Sanitize sensitive data
    enhanced.metadata = this.sanitizeSensitiveData(enhanced.metadata);
    if (enhanced.userContext) {
      enhanced.userContext = this.sanitizeSensitiveData(enhanced.userContext);
    }

    return enhanced;
  }

  /**
   * Generate error signature for deduplication
   */
  private generateErrorSignature(error: Error, context: EnhancedErrorContext): string {
    const components = [
      error.name,
      error.message,
      context.component,
      context.operation,
      context.stackTrace?.frames[0]?.file || '',
      context.stackTrace?.frames[0]?.line || '',
    ];

    return Buffer.from(components.join('|')).toString('base64');
  }

  /**
   * Check if error should be deduplicated
   */
  private shouldDeduplicate(errorSignature: string): boolean {
    const lastSeen = this.recentErrors.get(errorSignature);
    if (!lastSeen) return false;

    const timeSinceLastSeen = Date.now() - lastSeen.getTime();
    return timeSinceLastSeen < this.config.deduplicationWindow;
  }

  /**
   * Update existing error occurrence
   */
  private async updateExistingError(
    errorSignature: string,
    context: EnhancedErrorContext
  ): Promise<void> {
    const occurrence = this.errorOccurrences.get(errorSignature);
    if (occurrence) {
      occurrence.count++;
      occurrence.lastSeen = new Date();
      occurrence.contexts.push(context);

      // Update affected users and sessions
      if (context.userContext?.userId) {
        occurrence.affectedUsers.add(context.userContext.userId);
      }
      if (context.userContext?.sessionId) {
        occurrence.affectedSessions.add(context.userContext.sessionId);
      }

      // Keep only recent contexts (max 10)
      if (occurrence.contexts.length > 10) {
        occurrence.contexts = occurrence.contexts.slice(-10);
      }
    }

    this.recentErrors.set(errorSignature, new Date());
  }

  /**
   * Record new error occurrence
   */
  private async recordErrorOccurrence(
    errorSignature: string,
    context: EnhancedErrorContext
  ): Promise<void> {
    const occurrence: ErrorOccurrence = {
      errorId: context.errorId,
      errorSignature,
      firstSeen: new Date(),
      lastSeen: new Date(),
      count: 1,
      contexts: [context],
      resolved: false,
      severity: this.determineSeverity(context),
      affectedUsers: new Set(context.userContext?.userId ? [context.userContext.userId] : []),
      affectedSessions: new Set(context.userContext?.sessionId ? [context.userContext.sessionId] : []),
    };

    this.errorOccurrences.set(errorSignature, occurrence);
    this.recentErrors.set(errorSignature, new Date());
  }

  /**
   * Create trace error from enhanced context
   */
  private createTraceError(error: Error, context: EnhancedErrorContext): TraceError {
    return createTraceError(
      error.message,
      error.name,
      this.determineSeverity(context),
      context.component,
      context.traceContext,
      {
        errorId: context.errorId,
        stack: error.stack,
        cause: error.cause as string,
        recoverable: this.isRecoverableError(error, context),
        resolution: this.suggestResolution(error, context),
        metadata: {
          error_context: context,
          error_signature: this.generateErrorSignature(error, context),
          tracking_timestamp: new Date().toISOString(),
          constitutional_compliance: true,
        },
      }
    );
  }

  /**
   * Determine error severity based on context
   */
  private determineSeverity(context: EnhancedErrorContext): ErrorSeverity {
    // Critical for system-level errors
    if (context.component === 'system') {
      return 'critical';
    }

    // High for database and API errors
    if (['database', 'api'].includes(context.component)) {
      return 'high';
    }

    // Business impact consideration
    if (context.businessContext?.impactLevel) {
      switch (context.businessContext.impactLevel) {
        case 'critical': return 'critical';
        case 'high': return 'high';
        case 'medium': return 'medium';
        case 'low': return 'low';
      }
    }

    // Default to medium for other components
    return 'medium';
  }

  /**
   * Check if error is recoverable
   */
  private isRecoverableError(error: Error, context: EnhancedErrorContext): boolean {
    // Network errors are usually recoverable
    if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
      return true;
    }

    // Rate limiting is recoverable
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return true;
    }

    // Validation errors are usually not recoverable
    if (error.name === 'ValidationError' || error.name === 'TypeError') {
      return false;
    }

    // System errors are usually not recoverable
    if (context.component === 'system') {
      return false;
    }

    return true; // Default to recoverable
  }

  /**
   * Suggest resolution for error
   */
  private suggestResolution(error: Error, context: EnhancedErrorContext): string {
    if (error.message.includes('ECONNREFUSED')) {
      return 'Check service connectivity and restart if necessary';
    }

    if (error.message.includes('timeout')) {
      return 'Increase timeout values or optimize performance';
    }

    if (error.message.includes('rate limit')) {
      return 'Implement backoff strategy and reduce request frequency';
    }

    if (error.name === 'ValidationError') {
      return 'Fix input validation and data format issues';
    }

    if (context.component === 'database') {
      return 'Check database connectivity and query optimization';
    }

    return 'Review error context and logs for specific resolution steps';
  }

  /**
   * Send error to LangFuse
   */
  private async sendErrorToLangFuse(
    traceError: TraceError,
    context: EnhancedErrorContext
  ): Promise<void> {
    if (!this.langfuseClient.isReady()) {
      return;
    }

    try {
      await this.langfuseClient.createEvent({
        traceId: context.traceContext.traceId,
        name: 'comprehensive_error_tracked',
        metadata: {
          error_id: traceError.errorId,
          error_type: traceError.errorType,
          error_code: traceError.errorCode,
          severity: traceError.severity,
          component: traceError.component,
          recoverable: traceError.recoverable,
          resolution: traceError.resolution,
          context_captured: Boolean(context),
          stack_trace_captured: Boolean(context.stackTrace),
          breadcrumbs_captured: Boolean(context.breadcrumbs),
          constitutional_compliance: true,
        },
        input: this.config.captureContext ? this.sanitizeErrorContext(context) : undefined,
        output: {
          error_details: {
            message: traceError.message,
            type: traceError.errorType,
            severity: traceError.severity,
            recoverable: traceError.recoverable,
          },
          analysis: {
            component: traceError.component,
            operation: context.operation,
            user_affected: Boolean(context.userContext?.userId),
            business_impact: context.businessContext?.impactLevel,
          },
        },
        level: traceError.severity.toUpperCase() as any,
        statusMessage: `Error tracked: ${traceError.message}`,
        startTime: traceError.timestamp,
      });
    } catch (langfuseError) {
      rootLogger.warn('Failed to send error to LangFuse', {
        error_id: traceError.errorId,
        langfuse_error: langfuseError instanceof Error ? langfuseError.message : String(langfuseError),
      });
    }
  }

  /**
   * Analyze error for patterns and insights
   */
  private async analyzeError(context: EnhancedErrorContext): Promise<ErrorAnalysis> {
    return await withErrorHandling(
      async () => {
        const pattern = this.identifyErrorPattern(context);
        const rootCause = this.identifyRootCause(context);
        const impactAssessment = this.assessImpact(context);
        const similarErrors = this.findSimilarErrors(context);
        const recommendations = this.generateRecommendations(context, pattern);

        return {
          errorId: context.errorId,
          pattern,
          rootCause,
          impactAssessment,
          similarErrors,
          recommendations,
          autoResolvable: this.isAutoResolvable(context, pattern),
          escalationNeeded: this.needsEscalation(impactAssessment),
        };
      },
      {
        component: 'error_tracker',
        operation: 'analyze_error',
        metadata: { error_id: context.errorId },
      },
      'medium'
    );
  }

  /**
   * Identify error pattern
   */
  private identifyErrorPattern(context: EnhancedErrorContext): ErrorPattern {
    // Simple pattern identification based on context
    // In a real implementation, this would use ML or statistical analysis

    let type: ErrorPattern['type'] = 'system-induced';
    if (context.userContext) {
      type = 'user-induced';
    }
    if (context.component === 'system') {
      type = 'system-induced';
    }

    return {
      type,
      frequency: 'occasional', // Would be calculated from historical data
      trend: 'stable', // Would be calculated from historical data
    };
  }

  /**
   * Identify root cause
   */
  private identifyRootCause(context: EnhancedErrorContext): string {
    if (context.stackTrace?.frames.length) {
      const topFrame = context.stackTrace.frames[0];
      return `Error originated in ${topFrame.function} at ${topFrame.file}:${topFrame.line}`;
    }

    return `Error in ${context.component} during ${context.operation}`;
  }

  /**
   * Assess error impact
   */
  private assessImpact(context: EnhancedErrorContext): ErrorAnalysis['impactAssessment'] {
    const severity = this.determineSeverity(context);

    let userImpact = 0;
    let businessImpact = 0;
    let technicalImpact = 0;

    switch (severity) {
      case 'critical':
        userImpact = 100;
        businessImpact = 100;
        technicalImpact = 100;
        break;
      case 'high':
        userImpact = 75;
        businessImpact = 75;
        technicalImpact = 75;
        break;
      case 'medium':
        userImpact = 50;
        businessImpact = 50;
        technicalImpact = 50;
        break;
      case 'low':
        userImpact = 25;
        businessImpact = 25;
        technicalImpact = 25;
        break;
    }

    // Adjust based on business context
    if (context.businessContext?.affectedUsers) {
      userImpact = Math.min(100, userImpact + (context.businessContext.affectedUsers * 2));
    }

    if (context.businessContext?.financialImpact) {
      businessImpact = Math.min(100, businessImpact + (context.businessContext.financialImpact / 1000));
    }

    return {
      severity,
      userImpact,
      businessImpact,
      technicalImpact,
    };
  }

  /**
   * Find similar errors
   */
  private findSimilarErrors(context: EnhancedErrorContext): string[] {
    const similar: string[] = [];
    const currentSignature = this.generateErrorSignature(
      new Error(context.metadata?.error_message || 'Unknown'),
      context
    );

    for (const [signature, occurrence] of this.errorOccurrences.entries()) {
      if (signature !== currentSignature) {
        // Simple similarity check - in real implementation would use more sophisticated matching
        const similarity = this.calculateSimilarity(signature, currentSignature);
        if (similarity > 0.7) {
          similar.push(occurrence.errorId);
        }
      }
    }

    return similar.slice(0, 5); // Return top 5 similar errors
  }

  /**
   * Calculate similarity between error signatures (simplified)
   */
  private calculateSimilarity(sig1: string, sig2: string): number {
    // Simple similarity calculation - in real implementation would use more sophisticated algorithms
    const len1 = sig1.length;
    const len2 = sig2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1;

    let matches = 0;
    for (let i = 0; i < Math.min(len1, len2); i++) {
      if (sig1[i] === sig2[i]) matches++;
    }

    return matches / maxLen;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(context: EnhancedErrorContext, pattern: ErrorPattern): string[] {
    const recommendations: string[] = [];

    if (pattern.type === 'transient') {
      recommendations.push('Implement retry logic with exponential backoff');
    }

    if (pattern.frequency === 'frequent') {
      recommendations.push('Investigate and fix underlying cause to prevent recurrence');
    }

    if (context.component === 'database') {
      recommendations.push('Check database performance and connection pooling');
    }

    if (context.component === 'api') {
      recommendations.push('Review API rate limits and error handling');
    }

    recommendations.push('Monitor error trends and set up alerts for similar issues');

    return recommendations;
  }

  /**
   * Check if error is auto-resolvable
   */
  private isAutoResolvable(context: EnhancedErrorContext, pattern: ErrorPattern): boolean {
    return pattern.type === 'transient' && pattern.frequency === 'rare';
  }

  /**
   * Check if error needs escalation
   */
  private needsEscalation(impact: ErrorAnalysis['impactAssessment']): boolean {
    return impact.severity === 'critical' ||
           impact.userImpact > 80 ||
           impact.businessImpact > 80;
  }

  /**
   * Check if error should trigger real-time alert
   */
  private shouldAlert(analysis: ErrorAnalysis): boolean {
    return analysis.escalationNeeded ||
           analysis.impactAssessment.severity === 'critical' ||
           analysis.pattern.type === 'cascading';
  }

  /**
   * Send real-time alert
   */
  private async sendRealTimeAlert(
    error: Error,
    context: EnhancedErrorContext,
    analysis: ErrorAnalysis
  ): Promise<void> {
    // In a real implementation, this would send alerts via email, Slack, PagerDuty, etc.
    rootLogger.error('CRITICAL ERROR ALERT', {
      error_id: context.errorId,
      error_message: error.message,
      component: context.component,
      operation: context.operation,
      severity: analysis.impactAssessment.severity,
      user_impact: analysis.impactAssessment.userImpact,
      business_impact: analysis.impactAssessment.businessImpact,
      escalation_needed: analysis.escalationNeeded,
      recommendations: analysis.recommendations,
      user_id: context.userContext?.userId,
      session_id: context.userContext?.sessionId,
    });
  }

  /**
   * Log error with comprehensive context
   */
  private async logErrorWithContext(
    error: Error,
    context: EnhancedErrorContext,
    analysis: ErrorAnalysis
  ): Promise<void> {
    const logLevel = analysis.impactAssessment.severity === 'critical' ? 'error' : 'warn';

    rootLogger[logLevel]('Comprehensive error tracked', {
      error_id: context.errorId,
      error_type: error.name,
      error_message: error.message,
      component: context.component,
      operation: context.operation,
      severity: analysis.impactAssessment.severity,
      recoverable: this.isRecoverableError(error, context),
      user_id: context.userContext?.userId,
      session_id: context.userContext?.sessionId,
      trace_id: context.traceContext.traceId,
      impact_assessment: analysis.impactAssessment,
      error_pattern: analysis.pattern,
      recommendations: analysis.recommendations,
      stack_frames: context.stackTrace?.frames.length || 0,
      breadcrumbs: context.breadcrumbs?.length || 0,
      constitutional_compliance: true,
    });
  }

  /**
   * Parse stack trace into structured format
   */
  private parseStackTrace(error: Error): { frames: StackFrame[]; truncated: boolean } {
    if (!error.stack) {
      return { frames: [], truncated: false };
    }

    const lines = error.stack.split('\n').slice(1); // Skip error message line
    const frames: StackFrame[] = [];
    let truncated = false;

    for (let i = 0; i < Math.min(lines.length, this.config.maxStackFrames); i++) {
      const line = lines[i].trim();
      const frame = this.parseStackFrame(line);
      if (frame) {
        frames.push(frame);
      }
    }

    if (lines.length > this.config.maxStackFrames) {
      truncated = true;
    }

    return { frames, truncated };
  }

  /**
   * Parse individual stack frame
   */
  private parseStackFrame(line: string): StackFrame | null {
    // Simple stack frame parsing - in real implementation would handle various formats
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
    if (match) {
      return {
        function: match[1],
        file: match[2],
        line: parseInt(match[3]),
        column: parseInt(match[4]),
      };
    }

    // Alternative format
    const altMatch = line.match(/at\s+(.+?):(\d+):(\d+)/);
    if (altMatch) {
      return {
        function: '<anonymous>',
        file: altMatch[1],
        line: parseInt(altMatch[2]),
        column: parseInt(altMatch[3]),
      };
    }

    return null;
  }

  /**
   * Add breadcrumb to tracking
   */
  addBreadcrumb(breadcrumb: ErrorBreadcrumb): void {
    if (!this.config.enabled || !this.config.captureBreadcrumbs) {
      return;
    }

    this.breadcrumbs.push(breadcrumb);

    // Keep only recent breadcrumbs
    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.config.maxBreadcrumbs);
    }
  }

  /**
   * Sanitize sensitive data from error context
   */
  private sanitizeSensitiveData(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized = { ...data };
    for (const field of this.config.sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Sanitize error context for LangFuse
   */
  private sanitizeErrorContext(context: EnhancedErrorContext): any {
    const sanitized = { ...context };

    // Remove or redact sensitive information
    if (sanitized.userContext) {
      sanitized.userContext = this.sanitizeSensitiveData(sanitized.userContext);
    }

    if (sanitized.metadata) {
      sanitized.metadata = this.sanitizeSensitiveData(sanitized.metadata);
    }

    // Limit context size
    const contextStr = JSON.stringify(sanitized);
    if (contextStr.length > this.config.maxContextSize) {
      return {
        _truncated: true,
        _original_size: contextStr.length,
        _max_size: this.config.maxContextSize,
        summary: {
          error_id: context.errorId,
          component: context.component,
          operation: context.operation,
          severity: this.determineSeverity(context),
        },
      };
    }

    return sanitized;
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    total_errors: number;
    unique_errors: number;
    resolved_errors: number;
    critical_errors: number;
    high_errors: number;
    medium_errors: number;
    low_errors: number;
    affected_users: number;
    affected_sessions: number;
  } {
    const stats = {
      total_errors: 0,
      unique_errors: this.errorOccurrences.size,
      resolved_errors: 0,
      critical_errors: 0,
      high_errors: 0,
      medium_errors: 0,
      low_errors: 0,
      affected_users: new Set<string>(),
      affected_sessions: new Set<string>(),
    };

    for (const occurrence of this.errorOccurrences.values()) {
      stats.total_errors += occurrence.count;

      if (occurrence.resolved) {
        stats.resolved_errors++;
      }

      switch (occurrence.severity) {
        case 'critical': stats.critical_errors++; break;
        case 'high': stats.high_errors++; break;
        case 'medium': stats.medium_errors++; break;
        case 'low': stats.low_errors++; break;
      }

      occurrence.affectedUsers.forEach(user => stats.affected_users.add(user));
      occurrence.affectedSessions.forEach(session => stats.affected_sessions.add(session));
    }

    return {
      ...stats,
      affected_users: stats.affected_users.size,
      affected_sessions: stats.affected_sessions.size,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ErrorTrackingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    rootLogger.info('Error tracker configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ErrorTrackingConfig {
    return { ...this.config };
  }

  /**
   * Check if error tracking is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// Global singleton instance
let globalErrorTracker: ErrorTracker;

export function getErrorTracker(): ErrorTracker {
  if (!globalErrorTracker) {
    globalErrorTracker = new ErrorTracker();
  }
  return globalErrorTracker;
}

// Convenience function for quick error tracking
export async function trackError(
  error: Error,
  component: ComponentType,
  operation: string,
  additionalContext?: Partial<EnhancedErrorContext>
): Promise<string> {
  const tracker = getErrorTracker();
  const context: EnhancedErrorContext = {
    errorId: randomUUID(),
    component,
    operation,
    traceContext: createTraceContext({ traceId: randomUUID() }),
    ...additionalContext,
  };

  return await tracker.trackError(error, context);
}

// Constitutional compliance exports
export { ErrorTracker };
export default getErrorTracker;