/**
 * Orthodontic Business Intelligence Tools for Brius Technologies
 * Enhanced Supabase tools with time-aware analysis and domain expertise
 */

import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/environment.js';
import { TimeAwareUtils, generateComprehensiveContext } from '../utils/time-aware-analysis.js';

// Initialize Supabase client
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

/**
 * Orders & Commerce Analysis Tool
 */
export const ordersCommerceAnalysisTool = {
  id: 'orthodontic-orders-commerce-analysis',
  description: 'Analyze orders, revenue, and commerce metrics for Brius orthodontic operations with time-aware Central Time analysis',
  inputSchema: z.object({
    analysis_type: z.enum(['revenue_trends', 'order_lifecycle', 'payment_analysis', 'business_hours_pattern']).describe('Type of commerce analysis to perform'),
    time_range: z.enum(['7_days', '30_days', '90_days', '6_months', '12_months']).default('30_days').describe('Time range for analysis'),
    course_type: z.enum(['main', 'refinement', 'any', 'replacement']).optional().describe('Filter by specific course type'),
    business_hours_only: z.boolean().default(false).describe('Limit analysis to business hours (8 AM - 6 PM Central Time)'),
  }),
  execute: async (args: {
    analysis_type: 'revenue_trends' | 'order_lifecycle' | 'payment_analysis' | 'business_hours_pattern';
    time_range: '7_days' | '30_days' | '90_days' | '6_months' | '12_months';
    course_type?: 'main' | 'refinement' | 'any' | 'replacement';
    business_hours_only: boolean;
  }) => {
    const client = getSupabaseClient();
    const { analysis_type, time_range, course_type, business_hours_only } = args;

    try {
      const timeContext = generateComprehensiveContext(new Date().toISOString());
      
      let query = '';
      const timeRangeMap: Record<string, string> = {
        '7_days': '7 days',
        '30_days': '30 days',
        '90_days': '90 days',
        '6_months': '6 months',
        '12_months': '12 months',
      };

      switch (analysis_type) {
        case 'revenue_trends':
          query = `
            SELECT 
              DATE_TRUNC('month', submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as month_central,
              ${course_type ? `'${course_type}'` : 'course_type'} as course_type,
              COUNT(*) as order_count,
              SUM(amount) as total_revenue,
              AVG(amount) as avg_order_value,
              COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
              ROUND(COUNT(CASE WHEN status = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as completion_rate
            FROM orders 
            WHERE submitted_at IS NOT NULL 
              AND deleted = false
              AND submitted_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              ${course_type ? `AND course_type = '${course_type}'` : ''}
              ${business_hours_only ? `AND ${TimeAwareUtils.BusinessHoursAnalysis.getBusinessHoursFilter('submitted_at')}` : ''}
            GROUP BY month_central${course_type ? '' : ', course_type'}
            ORDER BY month_central DESC, total_revenue DESC;
          `;
          break;

        case 'order_lifecycle':
          query = `
            SELECT 
              o.course_type,
              COUNT(*) as total_orders,
              AVG(EXTRACT(EPOCH FROM (o.approved_at - o.submitted_at))/3600) as avg_approval_hours,
              AVG(EXTRACT(EPOCH FROM (o.shipped_at - o.approved_at))/24/3600) as avg_production_days,
              AVG(EXTRACT(EPOCH FROM (s.delivered_at - o.shipped_at))/24/3600) as avg_shipping_days,
              COUNT(CASE WHEN o.status = 'completed' THEN 1 END) as completed_count,
              ROUND(COUNT(CASE WHEN o.status = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as completion_rate
            FROM orders o
            LEFT JOIN shipments s ON o.id = s.order_id
            WHERE o.submitted_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              AND o.deleted = false
              ${course_type ? `AND o.course_type = '${course_type}'` : ''}
            GROUP BY o.course_type
            ORDER BY total_orders DESC;
          `;
          break;

        case 'payment_analysis':
          query = `
            SELECT 
              p.payment_method,
              p.status as payment_status,
              COUNT(*) as payment_count,
              SUM(p.amount) as total_amount,
              AVG(EXTRACT(EPOCH FROM (p.processed_at - p.created_at))/3600) as avg_processing_hours,
              COUNT(CASE WHEN p.status = 'completed' THEN 1 END) as successful_payments,
              ROUND(COUNT(CASE WHEN p.status = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as success_rate
            FROM payments p
            JOIN orders o ON p.order_id = o.id
            WHERE p.created_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              ${course_type ? `AND o.course_type = '${course_type}'` : ''}
            GROUP BY p.payment_method, p.status
            ORDER BY total_amount DESC;
          `;
          break;

        case 'business_hours_pattern':
          query = `
            SELECT 
              EXTRACT(HOUR FROM (submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) as hour_central,
              EXTRACT(DOW FROM (submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) as day_of_week,
              COUNT(*) as order_count,
              SUM(amount) as revenue,
              CASE 
                WHEN EXTRACT(HOUR FROM (submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) BETWEEN 8 AND 17 
                     AND EXTRACT(DOW FROM (submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) BETWEEN 1 AND 5
                THEN 'Business Hours'
                ELSE 'After Hours'
              END as time_category
            FROM orders
            WHERE submitted_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              AND deleted = false
              ${course_type ? `AND course_type = '${course_type}'` : ''}
            GROUP BY hour_central, day_of_week, time_category
            ORDER BY day_of_week, hour_central;
          `;
          break;
      }

      const { data, error } = await client.rpc('exec_sql', { sql: query.trim() });

      if (error) {
        throw new Error(`Orders & Commerce analysis failed: ${error.message}`);
      }

      return {
        success: true,
        analysis_type,
        time_range,
        course_type,
        business_hours_only,
        time_context: timeContext.timeContext,
        data: data || [],
        query_executed: query.trim(),
        note: 'Analysis completed using submitted_at column for accurate business timing',
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        analysis_type,
        time_range,
      };
    }
  },
};

/**
 * Operations Analysis Tool
 */
export const operationsAnalysisTool = {
  id: 'orthodontic-operations-analysis',
  description: 'Analyze technician performance, task management, and operational efficiency for Brius manufacturing operations',
  inputSchema: z.object({
    analysis_type: z.enum(['technician_performance', 'quality_metrics', 'workflow_analysis', 'capacity_planning']).describe('Type of operations analysis'),
    time_range: z.enum(['7_days', '30_days', '90_days', '6_months']).default('30_days').describe('Time range for analysis'),
    technician_role: z.enum(['sectioning', 'quality_control', 'designing', 'manufacturing', 'master']).optional().describe('Filter by technician role'),
    quality_threshold: z.number().min(0).max(100).default(80).describe('Quality score threshold for analysis'),
  }),
  execute: async (args: {
    analysis_type: 'technician_performance' | 'quality_metrics' | 'workflow_analysis' | 'capacity_planning';
    time_range: '7_days' | '30_days' | '90_days' | '6_months';
    technician_role?: 'sectioning' | 'quality_control' | 'designing' | 'manufacturing' | 'master';
    quality_threshold: number;
  }) => {
    const client = getSupabaseClient();
    const { analysis_type, time_range, technician_role, quality_threshold } = args;

    try {
      const timeContext = generateComprehensiveContext(new Date().toISOString());
      
      let query = '';
      const timeRangeMap: Record<string, string> = {
        '7_days': '7 days',
        '30_days': '30 days',
        '90_days': '90 days',
        '6_months': '6 months',
      };

      switch (analysis_type) {
        case 'technician_performance':
          query = `
            SELECT 
              CONCAT(t.first_name, ' ', t.last_name) as technician_name,
              tr.role_type,
              t.specialty,
              COUNT(tasks.id) as tasks_completed,
              AVG(tasks.quality_score) as avg_quality_score,
              AVG(EXTRACT(EPOCH FROM (tasks.completed_at - tasks.assigned_at))/3600) as avg_completion_hours,
              COUNT(CASE WHEN tasks.quality_score >= ${quality_threshold} THEN 1 END) as high_quality_tasks,
              COUNT(CASE WHEN tasks.completed_at <= tasks.due_at THEN 1 END) as on_time_tasks,
              ROUND(COUNT(CASE WHEN tasks.completed_at <= tasks.due_at THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as on_time_rate
            FROM technicians t
            JOIN technician_roles tr ON t.id = tr.technician_id
            JOIN tasks ON tasks.assigned_to = t.profile_id
            WHERE tasks.status = 'completed'
              AND tasks.completed_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              AND t.is_active = true
              ${technician_role ? `AND tr.role_type = '${technician_role}'` : ''}
            GROUP BY technician_name, tr.role_type, t.specialty
            ORDER BY avg_quality_score DESC, tasks_completed DESC;
          `;
          break;

        case 'quality_metrics':
          query = `
            SELECT 
              DATE_TRUNC('week', t.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as week_central,
              tr.role_type,
              COUNT(*) as tasks_completed,
              AVG(t.quality_score) as avg_quality_score,
              COUNT(CASE WHEN t.quality_score < 70 THEN 1 END) as poor_quality_count,
              COUNT(CASE WHEN t.quality_score >= 90 THEN 1 END) as excellent_quality_count,
              ROUND(COUNT(CASE WHEN t.quality_score >= 90 THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as excellence_rate
            FROM tasks t
            JOIN technicians tech ON t.assigned_to = tech.profile_id
            JOIN technician_roles tr ON tech.id = tr.technician_id
            WHERE t.status = 'completed'
              AND t.completed_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              AND t.quality_score IS NOT NULL
              ${technician_role ? `AND tr.role_type = '${technician_role}'` : ''}
            GROUP BY week_central, tr.role_type
            ORDER BY week_central DESC, excellence_rate DESC;
          `;
          break;

        case 'workflow_analysis':
          query = `
            SELECT 
              tmpl.name as template_name,
              tmpl.action_name,
              COUNT(t.id) as task_count,
              AVG(t.quality_score) as avg_quality,
              AVG(EXTRACT(EPOCH FROM (t.completed_at - t.assigned_at))/3600) as avg_hours,
              tmpl.estimated_duration_minutes / 60.0 as estimated_hours,
              COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_count,
              COUNT(CASE WHEN t.quality_score < ${quality_threshold} THEN 1 END) as quality_issues
            FROM tasks t
            JOIN templates tmpl ON t.template_id = tmpl.id
            WHERE t.assigned_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
            GROUP BY tmpl.name, tmpl.action_name, tmpl.estimated_duration_minutes
            HAVING COUNT(t.id) >= 3
            ORDER BY task_count DESC, avg_quality DESC;
          `;
          break;

        case 'capacity_planning':
          query = `
            SELECT 
              tr.role_type,
              COUNT(DISTINCT t.id) as active_technicians,
              COUNT(tasks.id) as total_tasks,
              AVG(EXTRACT(EPOCH FROM (tasks.completed_at - tasks.assigned_at))/3600) as avg_task_hours,
              COUNT(tasks.id) / COUNT(DISTINCT t.id) as tasks_per_technician,
              SUM(tmpl.estimated_duration_minutes) / 60.0 / COUNT(DISTINCT t.id) as estimated_hours_per_technician
            FROM technicians t
            JOIN technician_roles tr ON t.id = tr.technician_id
            LEFT JOIN tasks ON tasks.assigned_to = t.profile_id
            LEFT JOIN templates tmpl ON tasks.template_id = tmpl.id
            WHERE t.is_active = true
              AND (tasks.assigned_at IS NULL OR tasks.assigned_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}'))
              ${technician_role ? `AND tr.role_type = '${technician_role}'` : ''}
            GROUP BY tr.role_type
            ORDER BY active_technicians DESC;
          `;
          break;
      }

      const { data, error } = await client.rpc('exec_sql', { sql: query.trim() });

      if (error) {
        throw new Error(`Operations analysis failed: ${error.message}`);
      }

      return {
        success: true,
        analysis_type,
        time_range,
        technician_role,
        quality_threshold,
        time_context: timeContext.timeContext,
        business_context: timeContext.businessContext,
        data: data || [],
        query_executed: query.trim(),
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        analysis_type,
      };
    }
  },
};

/**
 * Clinical Analysis Tool
 */
export const clinicalAnalysisTool = {
  id: 'orthodontic-clinical-analysis',
  description: 'Analyze treatment outcomes, patient journeys, and clinical effectiveness for Brius orthodontic treatments',
  inputSchema: z.object({
    analysis_type: z.enum(['treatment_outcomes', 'patient_journey', 'doctor_performance', 'complexity_analysis']).describe('Type of clinical analysis'),
    time_range: z.enum(['6_months', '12_months', '18_months', '24_months']).default('12_months').describe('Time range for clinical analysis'),
    complexity_filter: z.enum(['simple', 'moderate', 'complex', 'comprehensive', 'extraction', 'surgical']).optional().describe('Filter by case complexity'),
    doctor_id: z.string().uuid().optional().describe('Filter by specific doctor'),
  }),
  execute: async (args: {
    analysis_type: 'treatment_outcomes' | 'patient_journey' | 'doctor_performance' | 'complexity_analysis';
    time_range: '6_months' | '12_months' | '18_months' | '24_months';
    complexity_filter?: 'simple' | 'moderate' | 'complex' | 'comprehensive' | 'extraction' | 'surgical';
    doctor_id?: string;
  }) => {
    const client = getSupabaseClient();
    const { analysis_type, time_range, complexity_filter, doctor_id } = args;

    try {
      const timeContext = generateComprehensiveContext(new Date().toISOString());
      
      let query = '';
      const timeRangeMap: Record<string, string> = {
        '6_months': '6 months',
        '12_months': '12 months',
        '18_months': '18 months',
        '24_months': '24 months',
      };

      switch (analysis_type) {
        case 'treatment_outcomes':
          query = `
            SELECT 
              c.complexity,
              CONCAT(dp.first_name, ' ', dp.last_name) as doctor_name,
              COUNT(*) as total_cases,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_cases,
              ROUND(COUNT(CASE WHEN c.status = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as success_rate,
              AVG(c.actual_duration_months) as avg_actual_duration,
              AVG(c.estimated_duration_months) as avg_estimated_duration,
              COUNT(CASE WHEN c.actual_duration_months <= c.estimated_duration_months THEN 1 END) as on_schedule_count,
              COUNT(CASE WHEN c.actual_duration_months <= 12 THEN 1 END) as brius_advantage_count
            FROM cases c
            JOIN doctors d ON c.primary_doctor_id = d.id
            JOIN profiles dp ON d.profile_id = dp.id
            WHERE c.treatment_start_date >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              AND c.treatment_start_date IS NOT NULL
              ${complexity_filter ? `AND c.complexity = '${complexity_filter}'` : ''}
              ${doctor_id ? `AND d.id = '${doctor_id}'` : ''}
            GROUP BY c.complexity, doctor_name
            HAVING COUNT(*) >= 3
            ORDER BY success_rate DESC, total_cases DESC;
          `;
          break;

        case 'patient_journey':
          query = `
            WITH patient_journey AS (
              SELECT 
                p.id as patient_id,
                CONCAT(prof.first_name, ' ', prof.last_name) as patient_name,
                p.status as current_status,
                c.complexity,
                EXTRACT(EPOCH FROM (c.diagnosis_date - c.consultation_date))/24/3600 as consultation_to_diagnosis_days,
                EXTRACT(EPOCH FROM (c.treatment_start_date - c.diagnosis_date))/24/3600 as diagnosis_to_treatment_days,
                c.actual_duration_months
              FROM patients p
              JOIN profiles prof ON p.profile_id = prof.id
              LEFT JOIN cases c ON p.id = c.patient_id
              WHERE p.enrolled_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
                ${complexity_filter ? `AND c.complexity = '${complexity_filter}'` : ''}
            )
            SELECT 
              current_status,
              complexity,
              COUNT(*) as patient_count,
              AVG(consultation_to_diagnosis_days) as avg_consultation_to_diagnosis_days,
              AVG(diagnosis_to_treatment_days) as avg_diagnosis_to_treatment_days,
              AVG(actual_duration_months) as avg_treatment_months,
              COUNT(CASE WHEN actual_duration_months <= 12 THEN 1 END) as brius_timeline_count
            FROM patient_journey
            WHERE consultation_to_diagnosis_days IS NOT NULL
            GROUP BY current_status, complexity
            ORDER BY patient_count DESC;
          `;
          break;

        case 'doctor_performance':
          query = `
            SELECT 
              CONCAT(dp.first_name, ' ', dp.last_name) as doctor_name,
              d.specialty,
              d.years_experience,
              COUNT(c.id) as total_cases,
              COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_cases,
              AVG(c.actual_duration_months) as avg_treatment_duration,
              COUNT(CASE WHEN c.complexity IN ('complex', 'comprehensive') THEN 1 END) as complex_cases,
              COUNT(DISTINCT p.id) as unique_patients,
              ROUND(COUNT(DISTINCT p.id)::numeric / d.max_patient_load::numeric * 100, 2) as capacity_utilization
            FROM doctors d
            JOIN profiles dp ON d.profile_id = dp.id
            LEFT JOIN cases c ON d.id = c.primary_doctor_id
            LEFT JOIN patients p ON c.patient_id = p.id
            WHERE d.status = 'active'
              AND (c.created_at IS NULL OR c.created_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}'))
              ${doctor_id ? `AND d.id = '${doctor_id}'` : ''}
            GROUP BY doctor_name, d.specialty, d.years_experience, d.max_patient_load
            ORDER BY completed_cases DESC, avg_treatment_duration ASC;
          `;
          break;

        case 'complexity_analysis':
          query = `
            WITH treatment_performance AS (
              SELECT 
                c.complexity,
                c.estimated_duration_months,
                c.actual_duration_months,
                CASE 
                  WHEN c.actual_duration_months <= 6 THEN 'Fast Track (≤6 months)'
                  WHEN c.actual_duration_months <= 12 THEN 'Standard Brius (6-12 months)'
                  WHEN c.actual_duration_months <= 18 THEN 'Extended (12-18 months)'
                  ELSE 'Traditional Timeline (>18 months)'
                END as timeline_category
              FROM cases c
              WHERE c.status = 'completed'
                AND c.treatment_start_date >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
                AND c.actual_duration_months IS NOT NULL
                ${complexity_filter ? `AND c.complexity = '${complexity_filter}'` : ''}
            )
            SELECT 
              complexity,
              timeline_category,
              COUNT(*) as case_count,
              AVG(actual_duration_months) as avg_duration,
              MIN(actual_duration_months) as min_duration,
              MAX(actual_duration_months) as max_duration,
              ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER (PARTITION BY complexity) * 100, 2) as percentage_of_complexity
            FROM treatment_performance
            GROUP BY complexity, timeline_category
            ORDER BY complexity, case_count DESC;
          `;
          break;
      }

      const { data, error } = await client.rpc('exec_sql', { sql: query.trim() });

      if (error) {
        throw new Error(`Clinical analysis failed: ${error.message}`);
      }

      return {
        success: true,
        analysis_type,
        time_range,
        complexity_filter,
        doctor_id,
        time_context: timeContext.timeContext,
        business_context: timeContext.businessContext,
        data: data || [],
        query_executed: query.trim(),
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        analysis_type,
      };
    }
  },
};

/**
 * Customer Service Analysis Tool
 */
export const customerServiceAnalysisTool = {
  id: 'orthodontic-customer-service-analysis',
  description: 'Analyze customer feedback, communication effectiveness, and service quality for Brius orthodontic operations',
  inputSchema: z.object({
    analysis_type: z.enum(['feedback_sentiment', 'communication_effectiveness', 'satisfaction_trends', 'response_efficiency']).describe('Type of customer service analysis'),
    time_range: z.enum(['30_days', '90_days', '6_months', '12_months']).default('90_days').describe('Time range for analysis'),
    feedback_type: z.enum(['complaint', 'suggestion', 'compliment', 'quality_issue', 'service_issue']).optional().describe('Filter by feedback type'),
    severity_filter: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter by severity level'),
  }),
  execute: async (args: {
    analysis_type: 'feedback_sentiment' | 'communication_effectiveness' | 'satisfaction_trends' | 'response_efficiency';
    time_range: '30_days' | '90_days' | '6_months' | '12_months';
    feedback_type?: 'complaint' | 'suggestion' | 'compliment' | 'quality_issue' | 'service_issue';
    severity_filter?: 'critical' | 'high' | 'medium' | 'low';
  }) => {
    const client = getSupabaseClient();
    const { analysis_type, time_range, feedback_type, severity_filter } = args;

    try {
      const timeContext = generateComprehensiveContext(new Date().toISOString());
      
      let query = '';
      const timeRangeMap: Record<string, string> = {
        '30_days': '30 days',
        '90_days': '90 days',
        '6_months': '6 months',
        '12_months': '12 months',
      };

      switch (analysis_type) {
        case 'feedback_sentiment':
          query = `
            SELECT 
              cf.feedback_type,
              cf.severity,
              DATE_TRUNC('month', cf.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as month_central,
              COUNT(*) as feedback_count,
              AVG(cf.response_time_hours) as avg_response_hours,
              COUNT(CASE WHEN cf.customer_satisfied = true THEN 1 END) as satisfied_count,
              ROUND(COUNT(CASE WHEN cf.customer_satisfied = true THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as satisfaction_rate,
              COUNT(CASE WHEN cf.resulted_in_remake = true THEN 1 END) as remake_count,
              SUM(CASE WHEN cf.resulted_in_discount = true THEN cf.discount_amount ELSE 0 END) as total_discount_amount
            FROM customer_feedback cf
            WHERE cf.created_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              ${feedback_type ? `AND cf.feedback_type = '${feedback_type}'` : ''}
              ${severity_filter ? `AND cf.severity = '${severity_filter}'` : ''}
            GROUP BY cf.feedback_type, cf.severity, month_central
            ORDER BY month_central DESC, feedback_count DESC;
          `;
          break;

        case 'communication_effectiveness':
          query = `
            SELECT 
              cm.message_type,
              DATE_TRUNC('week', cm.sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as week_central,
              COUNT(*) as messages_sent,
              COUNT(CASE WHEN cm.read_at IS NOT NULL THEN 1 END) as messages_read,
              AVG(EXTRACT(EPOCH FROM (cm.read_at - cm.sent_at))/3600) as avg_read_time_hours,
              COUNT(CASE WHEN cm.responded_at IS NOT NULL THEN 1 END) as messages_responded,
              AVG(EXTRACT(EPOCH FROM (cm.responded_at - cm.sent_at))/3600) as avg_response_time_hours,
              COUNT(CASE WHEN cm.requires_response = true AND cm.responded_at IS NULL THEN 1 END) as pending_responses
            FROM case_messages cm
            WHERE cm.sent_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
              AND cm.deleted = false
            GROUP BY cm.message_type, week_central
            ORDER BY week_central DESC, messages_sent DESC;
          `;
          break;

        case 'satisfaction_trends':
          query = `
            SELECT 
              c.status as treatment_phase,
              c.complexity,
              COUNT(DISTINCT p.id) as patient_count,
              COUNT(cf.id) as feedback_count,
              AVG(CASE WHEN cf.customer_satisfied = true THEN 1 ELSE 0 END) as satisfaction_rate,
              COUNT(CASE WHEN cf.feedback_type = 'compliment' THEN 1 END) as compliments,
              COUNT(CASE WHEN cf.feedback_type = 'complaint' THEN 1 END) as complaints,
              AVG(cf.response_time_hours) as avg_response_time_hours
            FROM cases c
            JOIN patients p ON c.patient_id = p.id
            LEFT JOIN customer_feedback cf ON cf.regarding_patient_id = p.profile_id
            WHERE c.created_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
            GROUP BY c.status, c.complexity
            ORDER BY patient_count DESC, satisfaction_rate DESC;
          `;
          break;

        case 'response_efficiency':
          query = `
            SELECT 
              td.discussion_type,
              td.author_role,
              COUNT(*) as discussion_count,
              COUNT(CASE WHEN td.requires_action = true THEN 1 END) as action_required_count,
              COUNT(CASE WHEN td.requires_action = true AND td.action_completed = true THEN 1 END) as actions_completed,
              ROUND(COUNT(CASE WHEN td.requires_action = true AND td.action_completed = true THEN 1 END)::numeric / 
                    NULLIF(COUNT(CASE WHEN td.requires_action = true THEN 1 END), 0)::numeric * 100, 2) as action_completion_rate,
              COUNT(CASE WHEN td.is_visible_to_patient = true THEN 1 END) as patient_visible_count
            FROM treatment_discussions td
            WHERE td.created_at >= (NOW() - INTERVAL '${timeRangeMap[time_range]}')
            GROUP BY td.discussion_type, td.author_role
            ORDER BY discussion_count DESC;
          `;
          break;
      }

      const { data, error } = await client.rpc('exec_sql', { sql: query.trim() });

      if (error) {
        throw new Error(`Customer service analysis failed: ${error.message}`);
      }

      return {
        success: true,
        analysis_type,
        time_range,
        feedback_type,
        severity_filter,
        time_context: timeContext.timeContext,
        business_context: timeContext.businessContext,
        data: data || [],
        query_executed: query.trim(),
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        analysis_type,
      };
    }
  },
};

/**
 * Executive Dashboard Tool
 */
/**
 * Executive Dashboard Tool
 */
export const executiveDashboardTool = {
  id: 'orthodontic-executive-dashboard',
  description: 'Generate comprehensive executive dashboard with key metrics across all four domains for Brius Technologies',
  inputSchema: z.object({
    time_period: z.enum(['current_month', 'previous_month', 'current_quarter', 'ytd']).default('current_month').describe('Time period for dashboard metrics'),
    include_trends: z.boolean().default(true).describe('Include trend analysis and comparisons'),
  }),
  execute: async (args: {
    time_period: 'current_month' | 'previous_month' | 'current_quarter' | 'ytd';
    include_trends: boolean;
  }) => {
    const client = getSupabaseClient();
    const { time_period, include_trends } = args;

    try {
      const timeContext = generateComprehensiveContext(new Date().toISOString());
      
      const query = `
        WITH time_periods AS (
          SELECT
            'Current Month' as period,
            DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Chicago') as start_date,
            NOW() as end_date
          UNION ALL
          SELECT
            'Previous Month' as period,
            DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Chicago') - INTERVAL '1 month' as start_date,
            DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Chicago') as end_date
          UNION ALL
          SELECT
            'Current Quarter' as period,
            DATE_TRUNC('quarter', NOW() AT TIME ZONE 'America/Chicago') as start_date,
            NOW() as end_date
        ),
        metrics AS (
          SELECT
            tp.period,
            -- Orders & Commerce
            COUNT(DISTINCT o.id) as total_orders,
            SUM(o.amount) as total_revenue,
            COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) as completed_orders,
            
            -- Operations
            COUNT(DISTINCT t.id) as total_tasks,
            AVG(t.quality_score) as avg_quality_score,
            COUNT(DISTINCT tech.id) as active_technicians,
            
            -- Clinical
            COUNT(DISTINCT c.id) as total_cases,
            COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as completed_cases,
            AVG(c.actual_duration_months) as avg_treatment_months,
            
            -- Customer Service
            COUNT(DISTINCT cf.id) as feedback_items,
            AVG(CASE WHEN cf.customer_satisfied = true THEN 1 ELSE 0 END) as satisfaction_rate
            
          FROM time_periods tp
          LEFT JOIN orders o ON o.submitted_at >= tp.start_date AND o.submitted_at < tp.end_date AND o.deleted = false
          LEFT JOIN tasks t ON t.completed_at >= tp.start_date AND t.completed_at < tp.end_date
          LEFT JOIN technicians tech ON t.assigned_to = tech.profile_id AND tech.is_active = true
          LEFT JOIN cases c ON c.created_at >= tp.start_date AND c.created_at < tp.end_date
          LEFT JOIN customer_feedback cf ON cf.created_at >= tp.start_date AND cf.created_at < tp.end_date
          GROUP BY tp.period
        )
        SELECT
          period,
          total_orders,
          total_revenue,
          ROUND(completed_orders::numeric / NULLIF(total_orders, 0)::numeric * 100, 2) as order_completion_rate,
          total_tasks,
          ROUND(avg_quality_score, 2) as avg_quality_score,
          active_technicians,
          total_cases,
          ROUND(completed_cases::numeric / NULLIF(total_cases, 0)::numeric * 100, 2) as case_completion_rate,
          ROUND(avg_treatment_months, 1) as avg_treatment_months,
          feedback_items,
          ROUND(satisfaction_rate * 100, 2) as satisfaction_percentage
        FROM metrics
        ORDER BY
          CASE
            WHEN period = 'Current Month' THEN 1
            WHEN period = 'Previous Month' THEN 2
            WHEN period = 'Current Quarter' THEN 3
          END;
      `;

      const { data, error } = await client.rpc('exec_sql', { sql: query.trim() });

      if (error) {
        throw new Error(`Executive dashboard analysis failed: ${error.message}`);
      }

      return {
        success: true,
        time_period,
        include_trends,
        time_context: timeContext.timeContext,
        business_context: timeContext.businessContext,
        database_context: timeContext.databaseContext,
        dashboard_data: data || [],
        query_executed: query.trim(),
        note: 'Executive dashboard generated with time-aware Central Time analysis and orthodontic business intelligence',
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        time_period,
      };
    }
  },
};

/**
 * Export all orthodontic intelligence tools
 */
export const orthodonticIntelligenceTools = [
  ordersCommerceAnalysisTool,
  operationsAnalysisTool,
  clinicalAnalysisTool,
  customerServiceAnalysisTool,
  executiveDashboardTool,
];