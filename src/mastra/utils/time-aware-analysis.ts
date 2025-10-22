/**
 * Time-Aware Analysis Utilities for Brius Technologies
 * Handles Central Time zone conversions and orthodontic business context
 */

import { z } from 'zod';

// Central Time zone identifier
export const CENTRAL_TIME_ZONE = 'America/Chicago';
export const BUSINESS_HOURS_START = 8; // 8 AM
export const BUSINESS_HOURS_END = 18; // 6 PM (18:00)

/**
 * Convert UTC timestamp to Central Time
 */
export function utcToCentralTime(utcTimestamp: Date | string): Date {
  const date = typeof utcTimestamp === 'string' ? new Date(utcTimestamp) : utcTimestamp;
  return new Date(date.toLocaleString('en-US', { timeZone: CENTRAL_TIME_ZONE }));
}

/**
 * Get current time in Central Time zone
 */
export function getCurrentCentralTime(): Date {
  return utcToCentralTime(new Date());
}

/**
 * Check if a timestamp falls within business hours (8 AM - 6 PM Central Time, weekdays)
 */
export function isBusinessHours(timestamp: Date | string): boolean {
  const centralTime = utcToCentralTime(timestamp);
  const hour = centralTime.getHours();
  const dayOfWeek = centralTime.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Monday (1) through Friday (5), 8 AM to 6 PM
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

/**
 * Get business hours status for current time
 */
export function getCurrentBusinessHoursStatus(): {
  isBusinessHours: boolean;
  currentCentralTime: Date;
  nextBusinessHourStart?: Date;
  hoursUntilBusinessStart?: number;
} {
  const currentCentral = getCurrentCentralTime();
  const isCurrentlyBusinessHours = isBusinessHours(currentCentral);
  
  let nextBusinessHourStart: Date | undefined;
  let hoursUntilBusinessStart: number | undefined;
  
  if (!isCurrentlyBusinessHours) {
    const tomorrow = new Date(currentCentral);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(BUSINESS_HOURS_START, 0, 0, 0);
    
    nextBusinessHourStart = tomorrow;
    hoursUntilBusinessStart = (tomorrow.getTime() - currentCentral.getTime()) / (1000 * 60 * 60);
  }
  
  return {
    isBusinessHours: isCurrentlyBusinessHours,
    currentCentralTime: currentCentral,
    nextBusinessHourStart,
    hoursUntilBusinessStart,
  };
}

/**
 * Generate time context string for agent prompts
 */
export function generateTimeContext(isoDatetime?: string): string {
  // Use current time if no datetime provided, or replace template string
  const actualDatetime = isoDatetime && isoDatetime !== '{{iso_datetime}}'
    ? isoDatetime
    : new Date().toISOString();
    
  const utcTime = new Date(actualDatetime);
  const centralTime = utcToCentralTime(utcTime);
  const businessHoursStatus = getCurrentBusinessHoursStatus();
  
  return `
**📅 CURRENT DATE & TIME CONTEXT**

UTC ISO Datetime: ${actualDatetime}
Central Time (Business): ${centralTime.toLocaleString('en-US', {
  timeZone: CENTRAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short'
})}

Business Hours Status: ${businessHoursStatus.isBusinessHours ? 'WITHIN business hours' : 'OUTSIDE business hours'}
${businessHoursStatus.hoursUntilBusinessStart ? `Hours until next business day: ${businessHoursStatus.hoursUntilBusinessStart.toFixed(1)}` : ''}

**⏰ TIME-AWARE ANALYSIS CONTEXT**
- Business Hours: 8:00 AM - 6:00 PM Central Time (UTC-6)
- Current Status: ${businessHoursStatus.isBusinessHours ? 'Active business operations' : 'After-hours period'}
- Orthodontic Context: Consider treatment cycles (6-12 months) and appointment patterns (4-6 visits)
- Seasonal Awareness: Account for back-to-school, summer breaks, and holiday patterns
`;
}

/**
 * Orthodontic treatment cycle analysis utilities
 */
export const TreatmentCycles = {
  /**
   * Categorize treatment duration based on Brius standards
   */
  categorizeDuration(months: number): string {
    if (months <= 6) return 'Fast Track (≤6 months)';
    if (months <= 12) return 'Standard Brius (6-12 months)';
    if (months <= 18) return 'Extended (12-18 months)';
    return 'Traditional Timeline (>18 months)';
  },

  /**
   * Check if treatment meets Brius advantage timeline
   */
  meetsBriusAdvantage(months: number): boolean {
    return months <= 12;
  },

  /**
   * Calculate treatment progress percentage
   */
  calculateProgress(startDate: Date, currentDate: Date, estimatedMonths: number): number {
    const monthsElapsed = (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    return Math.min((monthsElapsed / estimatedMonths) * 100, 100);
  },
};

/**
 * Business hours analysis for operational insights
 */
export const BusinessHoursAnalysis = {
  /**
   * Generate SQL WHERE clause for business hours filtering
   */
  getBusinessHoursFilter(timestampColumn: string): string {
    return `
      EXTRACT(HOUR FROM (${timestampColumn} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) BETWEEN ${BUSINESS_HOURS_START} AND ${BUSINESS_HOURS_END - 1}
      AND EXTRACT(DOW FROM (${timestampColumn} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) BETWEEN 1 AND 5
    `;
  },

  /**
   * Generate SQL for time zone conversion
   */
  getCentralTimeConversion(timestampColumn: string): string {
    return `${timestampColumn} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago'`;
  },

  /**
   * Generate SQL for time-based aggregation
   */
  getTimeAggregation(timestampColumn: string, interval: 'hour' | 'day' | 'week' | 'month' | 'quarter'): string {
    return `DATE_TRUNC('${interval}', ${this.getCentralTimeConversion(timestampColumn)})`;
  },
};

/**
 * Orthodontic business context utilities
 */
export const OrthodonticContext = {
  /**
   * Treatment complexity levels with business impact
   */
  complexityLevels: {
    simple: { duration: '3-6 months', visits: '3-4', description: 'Minor alignment corrections' },
    moderate: { duration: '6-9 months', visits: '4-5', description: 'Standard orthodontic cases' },
    complex: { duration: '9-12 months', visits: '5-6', description: 'Advanced alignment needs' },
    comprehensive: { duration: '12-15 months', visits: '6-8', description: 'Full orthodontic reconstruction' },
    extraction: { duration: '12-18 months', visits: '6-10', description: 'Cases requiring tooth extraction' },
    surgical: { duration: '15-24 months', visits: '8-12', description: 'Surgical orthodontic cases' },
  },

  /**
   * Treatment phases and typical durations
   */
  treatmentPhases: {
    consultation: { duration: '1-2 weeks', description: 'Initial assessment and planning' },
    diagnosis: { duration: '1-2 weeks', description: 'Treatment plan development' },
    treatment_plan: { duration: '1-3 weeks', description: 'Plan approval and preparation' },
    active: { duration: '6-12 months', description: 'Active orthodontic treatment' },
    refinement: { duration: '2-4 months', description: 'Fine-tuning and adjustments' },
    retention: { duration: '6+ months', description: 'Maintaining results' },
  },

  /**
   * Course types and their business implications
   */
  courseTypes: {
    main: { description: 'Primary treatment course', typical_duration: '6-12 months' },
    refinement: { description: 'Treatment refinement phase', typical_duration: '2-4 months' },
    replacement: { description: 'Appliance replacement', typical_duration: '1-2 weeks' },
    any: { description: 'General treatment category', typical_duration: 'Variable' },
  },
};

/**
 * Generate comprehensive context for agent prompts
 */
export function generateComprehensiveContext(isoDatetime?: string): {
  timeContext: string;
  businessContext: string;
  databaseContext: string;
} {
  // Use current time if no datetime provided, or replace template string
  const actualDatetime = isoDatetime && isoDatetime !== '{{iso_datetime}}'
    ? isoDatetime
    : new Date().toISOString();
    
  const timeContext = generateTimeContext(actualDatetime);
  
  const businessContext = `
**🏥 BRIUS TECHNOLOGIES ORTHODONTIC CONTEXT**

**Company Profile:**
- Industry: Orthodontic Technology & Treatment Solutions
- Primary Product: Brava System (lingual braces with Independent Mover® technology)
- Treatment Innovation: Behind-the-teeth invisible orthodontic treatment
- Competitive Advantage: 6-12 month treatment cycles vs traditional 18-24 months
- Business Model: B2B serving orthodontists and dental practices

**Treatment Specifications:**
- Standard Duration: 6-12 months (55% faster than traditional)
- Appointment Pattern: 4-6 visits vs 12-24 traditional
- Technology: Patented biomechanical system for independent tooth movement
- Target Market: Premium invisible orthodontic solutions
`;

  const databaseContext = `
**🔍 DATABASE SCHEMA INTELLIGENCE**

**Critical Column Usage:**
- orders.submitted_at: PRIMARY timing column for business analysis
- orders.created_at: System tracking only (DO NOT use for business intelligence)
- cases.treatment_start_date: Treatment lifecycle tracking
- tasks.completed_at: Operational efficiency metrics

**Four Core Analysis Domains:**
1. 📦 ORDERS & COMMERCE: Revenue, order lifecycle, payment processing
2. ⚙️ OPERATIONS: Technician performance, task management, quality control  
3. 🏥 CLINICAL: Treatment plans, case complexity, patient journey analysis
4. 🎧 CUSTOMER SERVICE: Message analysis, sentiment tracking, feedback processing

**Key Relationships:**
- orders → patients → cases → treatment_plans (patient journey)
- orders → tasks → technicians (operational workflow)
- cases → case_messages → customer_feedback (service quality)
- doctors → patients → cases (clinical relationships)
`;

  return {
    timeContext,
    businessContext,
    databaseContext,
  };
}

/**
 * Validation schema for time-aware queries
 */
export const TimeAwareQuerySchema = z.object({
  query: z.string().min(1),
  timeRange: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  includeBusinessHoursOnly: z.boolean().optional().default(false),
  centralTimeZone: z.boolean().optional().default(true),
});

export type TimeAwareQuery = z.infer<typeof TimeAwareQuerySchema>;

/**
 * Generate SQL query with proper time zone handling
 */
export function generateTimeAwareSQL(
  baseQuery: string,
  options: {
    timestampColumn?: string;
    timeRange?: string;
    businessHoursOnly?: boolean;
  } = {}
): string {
  const { timestampColumn = 'created_at', timeRange = '30 days', businessHoursOnly = false } = options;
  
  let whereClause = `WHERE ${timestampColumn} >= (NOW() - INTERVAL '${timeRange}')`;
  
  if (businessHoursOnly) {
    whereClause += ` AND ${BusinessHoursAnalysis.getBusinessHoursFilter(timestampColumn)}`;
  }
  
  return `${baseQuery} ${whereClause}`;
}

/**
 * Export all utilities for agent use
 */
export const TimeAwareUtils = {
  utcToCentralTime,
  getCurrentCentralTime,
  isBusinessHours,
  getCurrentBusinessHoursStatus,
  generateTimeContext,
  generateComprehensiveContext,
  TreatmentCycles,
  BusinessHoursAnalysis,
  OrthodonticContext,
  generateTimeAwareSQL,
};