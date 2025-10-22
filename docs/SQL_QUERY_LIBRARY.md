# Brius Technologies - SQL Query Library
## Time-Aware Business Intelligence Queries

**Version:** 1.0  
**Date:** October 22, 2025  
**Database:** PostgreSQL with Orthodontic Business Schema  
**Time Zone:** Central Time (UTC-6)

---

## 📋 Query Standards

### **Time Zone Conversion Standard**
```sql
-- Always convert UTC timestamps to Central Time for business analysis
-- Use this pattern for all time-based queries
SELECT 
  column_name AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago' as central_time
FROM table_name;
```

### **Critical Column Usage**
```sql
-- ✅ CORRECT: Use submitted_at for order timing analysis
SELECT * FROM orders WHERE submitted_at >= '2024-01-01'::timestamptz;

-- ❌ INCORRECT: Do not use created_at for business timing
-- SELECT * FROM orders WHERE created_at >= '2024-01-01'::timestamptz;
```

---

## 📦 ORDERS & COMMERCE QUERIES

### **Monthly Revenue Analysis (Central Time)**
```sql
-- Revenue trends with proper time zone conversion
SELECT 
  DATE_TRUNC('month', submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as month_central,
  course_type,
  COUNT(*) as order_count,
  SUM(amount) as total_revenue,
  AVG(amount) as avg_order_value,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
  ROUND(COUNT(CASE WHEN status = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as completion_rate
FROM orders 
WHERE submitted_at IS NOT NULL 
  AND deleted = false
  AND submitted_at >= (NOW() - INTERVAL '12 months')
GROUP BY month_central, course_type
ORDER BY month_central DESC, total_revenue DESC;
```

### **Order Lifecycle Performance**
```sql
-- Order processing efficiency with time-to-completion metrics
SELECT 
  o.course_type,
  COUNT(*) as total_orders,
  AVG(EXTRACT(EPOCH FROM (o.approved_at - o.submitted_at))/3600) as avg_approval_hours,
  AVG(EXTRACT(EPOCH FROM (o.shipped_at - o.approved_at))/24/3600) as avg_production_days,
  AVG(EXTRACT(EPOCH FROM (s.delivered_at - o.shipped_at))/24/3600) as avg_shipping_days,
  COUNT(CASE WHEN o.status = 'completed' THEN 1 END) as completed_count
FROM orders o
LEFT JOIN shipments s ON o.id = s.order_id
WHERE o.submitted_at >= (NOW() - INTERVAL '6 months')
  AND o.deleted = false
GROUP BY o.course_type
ORDER BY total_orders DESC;
```

### **Business Hours Revenue Pattern**
```sql
-- Revenue patterns by business hours (8 AM - 6 PM Central)
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
WHERE submitted_at >= (NOW() - INTERVAL '3 months')
  AND deleted = false
GROUP BY hour_central, day_of_week, time_category
ORDER BY day_of_week, hour_central;
```

### **Payment Processing Analysis**
```sql
-- Payment efficiency and success rates
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
WHERE p.created_at >= (NOW() - INTERVAL '6 months')
GROUP BY p.payment_method, p.status
ORDER BY total_amount DESC;
```

---

## ⚙️ OPERATIONS QUERIES

### **Technician Performance Analysis**
```sql
-- Comprehensive technician productivity and quality metrics
SELECT 
  CONCAT(t.first_name, ' ', t.last_name) as technician_name,
  tr.role_type,
  t.specialty,
  COUNT(tasks.id) as tasks_completed,
  AVG(tasks.quality_score) as avg_quality_score,
  AVG(EXTRACT(EPOCH FROM (tasks.completed_at - tasks.assigned_at))/3600) as avg_completion_hours,
  COUNT(CASE WHEN tasks.quality_score >= 90 THEN 1 END) as high_quality_tasks,
  COUNT(CASE WHEN tasks.completed_at <= tasks.due_at THEN 1 END) as on_time_tasks,
  ROUND(COUNT(CASE WHEN tasks.completed_at <= tasks.due_at THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as on_time_rate
FROM technicians t
JOIN technician_roles tr ON t.id = tr.technician_id
JOIN tasks ON tasks.assigned_to = t.profile_id
WHERE tasks.status = 'completed'
  AND tasks.completed_at >= (NOW() - INTERVAL '30 days')
  AND t.is_active = true
GROUP BY technician_name, tr.role_type, t.specialty
ORDER BY avg_quality_score DESC, tasks_completed DESC;
```

### **Manufacturing Workflow Analysis**
```sql
-- Task completion patterns by template and complexity
SELECT 
  tmpl.name as template_name,
  tmpl.action_name,
  COUNT(t.id) as task_count,
  AVG(t.quality_score) as avg_quality,
  AVG(EXTRACT(EPOCH FROM (t.completed_at - t.assigned_at))/3600) as avg_hours,
  tmpl.estimated_duration_minutes / 60.0 as estimated_hours,
  COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_count,
  COUNT(CASE WHEN t.quality_score < 80 THEN 1 END) as quality_issues
FROM tasks t
JOIN templates tmpl ON t.template_id = tmpl.id
WHERE t.assigned_at >= (NOW() - INTERVAL '60 days')
GROUP BY tmpl.name, tmpl.action_name, tmpl.estimated_duration_minutes
HAVING COUNT(t.id) >= 5
ORDER BY task_count DESC, avg_quality DESC;
```

### **Quality Control Metrics**
```sql
-- Quality trends and defect analysis
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
  AND t.completed_at >= (NOW() - INTERVAL '12 weeks')
  AND t.quality_score IS NOT NULL
GROUP BY week_central, tr.role_type
ORDER BY week_central DESC, excellence_rate DESC;
```

---

## 🏥 CLINICAL QUERIES

### **Treatment Outcome Analysis**
```sql
-- Treatment success rates by complexity and duration
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
WHERE c.treatment_start_date >= (NOW() - INTERVAL '24 months')
  AND c.treatment_start_date IS NOT NULL
GROUP BY c.complexity, doctor_name
HAVING COUNT(*) >= 3  -- Minimum case volume
ORDER BY success_rate DESC, total_cases DESC;
```

### **Patient Journey Analysis**
```sql
-- Patient progression through treatment phases
WITH patient_journey AS (
  SELECT 
    p.id as patient_id,
    CONCAT(prof.first_name, ' ', prof.last_name) as patient_name,
    p.status as current_status,
    p.enrolled_at,
    c.consultation_date,
    c.diagnosis_date,
    c.treatment_start_date,
    c.treatment_end_date,
    c.complexity,
    EXTRACT(EPOCH FROM (c.diagnosis_date - c.consultation_date))/24/3600 as consultation_to_diagnosis_days,
    EXTRACT(EPOCH FROM (c.treatment_start_date - c.diagnosis_date))/24/3600 as diagnosis_to_treatment_days,
    c.actual_duration_months
  FROM patients p
  JOIN profiles prof ON p.profile_id = prof.id
  LEFT JOIN cases c ON p.id = c.patient_id
  WHERE p.enrolled_at >= (NOW() - INTERVAL '18 months')
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
WHERE consultation_date IS NOT NULL
GROUP BY current_status, complexity
ORDER BY patient_count DESC;
```

### **Doctor Performance Metrics**
```sql
-- Doctor productivity and case management effectiveness
SELECT 
  CONCAT(dp.first_name, ' ', dp.last_name) as doctor_name,
  d.specialty,
  d.years_experience,
  COUNT(c.id) as total_cases,
  COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_cases,
  AVG(c.actual_duration_months) as avg_treatment_duration,
  COUNT(CASE WHEN c.complexity IN ('complex', 'comprehensive') THEN 1 END) as complex_cases,
  AVG(CASE WHEN c.status = 'completed' THEN c.actual_duration_months END) as avg_completed_duration,
  COUNT(DISTINCT p.id) as unique_patients,
  d.max_patient_load,
  ROUND(COUNT(DISTINCT p.id)::numeric / d.max_patient_load::numeric * 100, 2) as capacity_utilization
FROM doctors d
JOIN profiles dp ON d.profile_id = dp.id
LEFT JOIN cases c ON d.id = c.primary_doctor_id
LEFT JOIN patients p ON c.patient_id = p.id
WHERE d.status = 'active'
  AND (c.created_at IS NULL OR c.created_at >= (NOW() - INTERVAL '12 months'))
GROUP BY doctor_name, d.specialty, d.years_experience, d.max_patient_load
ORDER BY completed_cases DESC, avg_treatment_duration ASC;
```

---

## 🎧 CUSTOMER SERVICE QUERIES

### **Customer Feedback Sentiment Analysis**
```sql
-- Customer satisfaction trends with response efficiency
SELECT 
  cf.feedback_type,
  cf.severity,
  DATE_TRUNC('month', cf.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as month_central,
  COUNT(*) as feedback_count,
  AVG(cf.response_time_hours) as avg_response_hours,
  COUNT(CASE WHEN cf.customer_satisfied = true THEN 1 END) as satisfied_count,
  ROUND(COUNT(CASE WHEN cf.customer_satisfied = true THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as satisfaction_rate,
  COUNT(CASE WHEN cf.resulted_in_remake = true THEN 1 END) as remake_count,
  COUNT(CASE WHEN cf.resulted_in_discount = true THEN 1 END) as discount_count,
  SUM(CASE WHEN cf.resulted_in_discount = true THEN cf.discount_amount ELSE 0 END) as total_discount_amount
FROM customer_feedback cf
WHERE cf.created_at >= (NOW() - INTERVAL '12 months')
GROUP BY cf.feedback_type, cf.severity, month_central
ORDER BY month_central DESC, feedback_count DESC;
```

### **Communication Effectiveness Analysis**
```sql
-- Message response patterns and communication quality
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
WHERE cm.sent_at >= (NOW() - INTERVAL '8 weeks')
  AND cm.deleted = false
GROUP BY cm.message_type, week_central
ORDER BY week_central DESC, messages_sent DESC;
```

### **Treatment Discussion Analysis**
```sql
-- Clinical communication patterns and discussion effectiveness
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
WHERE td.created_at >= (NOW() - INTERVAL '6 months')
GROUP BY td.discussion_type, td.author_role
ORDER BY discussion_count DESC;
```

---

## 📊 CROSS-DOMAIN ANALYTICS

### **Comprehensive Business Dashboard Query**
```sql
-- Executive dashboard with key metrics across all domains
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
```

### **Treatment Cycle Performance (6-12 Month Analysis)**
```sql
-- Brius treatment advantage analysis vs traditional timelines
WITH treatment_performance AS (
  SELECT 
    c.id,
    c.complexity,
    c.estimated_duration_months,
    c.actual_duration_months,
    CASE 
      WHEN c.actual_duration_months <= 6 THEN 'Fast Track (≤6 months)'
      WHEN c.actual_duration_months <= 12 THEN 'Standard Brius (6-12 months)'
      WHEN c.actual_duration_months <= 18 THEN 'Extended (12-18 months)'
      ELSE 'Traditional Timeline (>18 months)'
    END as timeline_category,
    CASE 
      WHEN c.actual_duration_months <= c.estimated_duration_months THEN 'On Schedule'
      WHEN c.actual_duration_months <= c.estimated_duration_months * 1.2 THEN 'Slightly Delayed'
      ELSE 'Significantly Delayed'
    END as schedule_performance
  FROM cases c
  WHERE c.status = 'completed'
    AND c.treatment_start_date >= (NOW() - INTERVAL '36 months')
    AND c.actual_duration_months IS NOT NULL
)
SELECT 
  complexity,
  timeline_category,
  schedule_performance,
  COUNT(*) as case_count,
  AVG(actual_duration_months) as avg_duration,
  MIN(actual_duration_months) as min_duration,
  MAX(actual_duration_months) as max_duration,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER (PARTITION BY complexity) * 100, 2) as percentage_of_complexity
FROM treatment_performance
GROUP BY complexity, timeline_category, schedule_performance
ORDER BY complexity, 
  CASE 
    WHEN timeline_category = 'Fast Track (≤6 months)' THEN 1
    WHEN timeline_category = 'Standard Brius (6-12 months)' THEN 2
    WHEN timeline_category = 'Extended (12-18 months)' THEN 3
    ELSE 4
  END;
```

### **Patient Satisfaction by Treatment Phase**
```sql
-- Patient satisfaction correlation with treatment progress
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
WHERE c.created_at >= (NOW() - INTERVAL '12 months')
GROUP BY c.status, c.complexity
ORDER BY patient_count DESC, satisfaction_rate DESC;
```

---

## 🕐 TIME-AWARE ANALYSIS FUNCTIONS

### **Business Hours Analysis Function**
```sql
-- Create function to analyze business hour patterns
CREATE OR REPLACE FUNCTION analyze_business_hours_pattern(
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  table_name TEXT,
  timestamp_column TEXT
)
RETURNS TABLE (
  time_category TEXT,
  hour_central INTEGER,
  day_of_week INTEGER,
  record_count BIGINT,
  percentage NUMERIC
) AS $$
BEGIN
  RETURN QUERY EXECUTE format('
    WITH hourly_data AS (
      SELECT 
        EXTRACT(HOUR FROM (%I AT TIME ZONE ''UTC'' AT TIME ZONE ''America/Chicago'')) as hour_central,
        EXTRACT(DOW FROM (%I AT TIME ZONE ''UTC'' AT TIME ZONE ''America/Chicago'')) as day_of_week,
        CASE 
          WHEN EXTRACT(HOUR FROM (%I AT TIME ZONE ''UTC'' AT TIME ZONE ''America/Chicago'')) BETWEEN 8 AND 17 
               AND EXTRACT(DOW FROM (%I AT TIME ZONE ''UTC'' AT TIME ZONE ''America/Chicago'')) BETWEEN 1 AND 5
          THEN ''Business Hours''
          ELSE ''After Hours''
        END as time_category
      FROM %I
      WHERE %I >= %L AND %I <= %L
    )
    SELECT 
      time_category,
      hour_central::INTEGER,
      day_of_week::INTEGER,
      COUNT(*) as record_count,
      ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
    FROM hourly_data
    GROUP BY time_category, hour_central, day_of_week
    ORDER BY day_of_week, hour_central',
    timestamp_column, timestamp_column, timestamp_column, timestamp_column,
    table_name, timestamp_column, start_date, timestamp_column, end_date
  );
END;
$$ LANGUAGE plpgsql;
```

### **Treatment Cycle Progress Function**
```sql
-- Function to analyze treatment progress within Brius timelines
CREATE OR REPLACE FUNCTION analyze_treatment_cycles()
RETURNS TABLE (
  treatment_category TEXT,
  complexity case_complexity_type,
  case_count BIGINT,
  avg_duration_months NUMERIC,
  on_schedule_percentage NUMERIC,
  brius_advantage_cases BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH treatment_analysis AS (
    SELECT 
      c.complexity,
      c.actual_duration_months,
      c.estimated_duration_months,
      CASE 
        WHEN COALESCE(c.actual_duration_months, EXTRACT(MONTH FROM AGE(NOW(), c.treatment_start_date))) <= 6 THEN 'Fast Track'
        WHEN COALESCE(c.actual_duration_months, EXTRACT(MONTH FROM AGE(NOW(), c.treatment_start_date))) <= 12 THEN 'Standard Brius'
        WHEN COALESCE(c.actual_duration_months, EXTRACT(MONTH FROM AGE(NOW(), c.treatment_start_date))) <= 18 THEN 'Extended'
        ELSE 'Traditional Timeline'
      END as treatment_category,
      CASE 
        WHEN c.actual_duration_months IS NOT NULL 
             AND c.actual_duration_months <= c.estimated_duration_months THEN 1 
        ELSE 0 
      END as on_schedule,
      CASE 
        WHEN COALESCE(c.actual_duration_months, EXTRACT(MONTH FROM AGE(NOW(), c.treatment_start_date))) <= 12 THEN 1 
        ELSE 0 
      END as brius_advantage
    FROM cases c
    WHERE c.treatment_start_date IS NOT NULL
      AND c.treatment_start_date >= (NOW() - INTERVAL '24 months')
  )
  SELECT 
    ta.treatment_category::TEXT,
    ta.complexity,
    COUNT(*)::BIGINT as case_count,
    ROUND(AVG(ta.actual_duration_months), 2) as avg_duration_months,
    ROUND(AVG(ta.on_schedule) * 100, 2) as on_schedule_percentage,
    SUM(ta.brius_advantage)::BIGINT as brius_advantage_cases
  FROM treatment_analysis ta
  GROUP BY ta.treatment_category, ta.complexity
  ORDER BY case_count DESC;
END;
$$ LANGUAGE plpgsql;
```

---

## 🔍 QUERY OPTIMIZATION GUIDELINES

### **Performance Best Practices**

1. **Time Range Filtering**
```sql
-- Always limit time ranges for performance
WHERE submitted_at >= (NOW() - INTERVAL '12 months')
```

2. **Index Usage**
```sql
-- Leverage existing indexes for optimal performance
-- orders: idx_orders_submitted, idx_orders_status
-- cases: idx_cases_complexity, idx_cases_status
-- tasks: idx_tasks_status, idx_tasks_assigned_to
```

3. **Proper Joins**
```sql
-- Use appropriate join types based on data relationships
LEFT JOIN for optional relationships
INNER JOIN for required relationships
```

4. **Aggregation Efficiency**
```sql
-- Use CASE WHEN for conditional aggregations
COUNT(CASE WHEN condition THEN 1 END) as conditional_count
```

### **Common Query Patterns**

**Time-Based Aggregation:**
```sql
DATE_TRUNC('month', timestamp_column AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')
```

**Business Hours Filter:**
```sql
WHERE EXTRACT(HOUR FROM (timestamp_column AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) BETWEEN 8 AND 17
  AND EXTRACT(DOW FROM (timestamp_column AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')) BETWEEN 1 AND 5
```

**Treatment Duration Analysis:**
```sql
EXTRACT(EPOCH FROM (end_timestamp - start_timestamp))/3600 as duration_hours
```

---

## 📈 EXAMPLE BUSINESS INTELLIGENCE QUERIES

### **Executive Summary Query**
```sql
-- Complete business overview for executive reporting
SELECT 
  'Brius Technologies Business Intelligence Summary' as report_title,
  NOW() AT TIME ZONE 'America/Chicago' as report_generated_central,
  
  -- Orders & Commerce Metrics
  (SELECT COUNT(*) FROM orders WHERE submitted_at >= DATE_TRUNC('month', NOW()) AND deleted = false) as current_month_orders,
  (SELECT SUM(amount) FROM orders WHERE submitted_at >= DATE_TRUNC('month', NOW()) AND deleted = false) as current_month_revenue,
  
  -- Operations Metrics  
  (SELECT COUNT(*) FROM tasks WHERE status = 'completed' AND completed_at >= DATE_TRUNC('month', NOW())) as current_month_tasks_completed,
  (SELECT ROUND(AVG(quality_score), 2) FROM tasks WHERE completed_at >= DATE_TRUNC('month', NOW()) AND quality_score IS NOT NULL) as current_month_avg_quality,
  
  -- Clinical Metrics
  (SELECT COUNT(*) FROM cases WHERE status = 'completed' AND treatment_end_date >= DATE_TRUNC('month', NOW())) as current_month_cases_completed,
  (SELECT ROUND(AVG(actual_duration_months), 2) FROM cases WHERE status = 'completed' AND treatment_end_date >= DATE_TRUNC('month', NOW())) as avg_treatment_duration,
  
  -- Customer Service Metrics
  (SELECT COUNT(*) FROM customer_feedback WHERE created_at >= DATE_TRUNC('month', NOW())) as current_month_feedback,
  (SELECT ROUND(AVG(CASE WHEN customer_satisfied = true THEN 1 ELSE 0 END) * 100, 2) FROM customer_feedback WHERE created_at >= DATE_TRUNC('month', NOW())) as satisfaction_percentage;
```

---

## 🚀 Advanced Analytics Examples

### **Predictive Treatment Duration Model**
```sql
-- Analyze factors affecting treatment duration for predictive modeling
SELECT 
  c.complexity,
  c.is_comprehensive,
  c.extraction_compromise,
  c.cbct_available,
  c.photos_available,
  COUNT(*) as case_count,
  AVG(c.actual_duration_months) as avg_duration,
  STDDEV(c.actual_duration_months) as duration