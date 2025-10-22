# Brius Technologies - Prompt Engineering Strategy
## Advanced Business Intelligence for Orthodontic Operations

**Version:** 1.1
**Date:** October 22, 2025
**Current Time Context:** 2025-10-22T13:23:00.000Z UTC
**Business Time Zone:** Central Time (UTC-6)

---

## 🚨 CRITICAL MASTRA STREAMING FIX

**IMPLEMENTED IN ALL AGENTS:** Added prominent instruction at the beginning of all agent prompts to prevent generation stopping after tool calls:

```
🚨 CRITICAL MASTRA STREAMING INSTRUCTION: After executing any tool call, you MUST continue generating a comprehensive response that interprets and explains the tool results. Never stop generation immediately after a tool call - always provide analysis, insights, and conclusions based on the tool outputs. This ensures users see the complete analysis in the stream.
```

**Dynamic Timestamp Replacement:** All `{{iso_datetime}}` template strings are now replaced with actual current timestamps using `${new Date().toISOString()}` to ensure real-time accuracy.

---

## 📋 Executive Summary

This document defines the prompt engineering strategy for Brius Technologies' business intelligence agents, specifically designed for orthodontic treatment operations. The system supports four core domains of information retrieval and analysis, with sophisticated time-aware capabilities and deep understanding of orthodontic business workflows.

### 🏢 Business Context: Brius Technologies

**Company Profile:**
- **Industry:** Orthodontic Technology & Treatment Solutions
- **Primary Product:** Brava System - Lingual braces with Independent Mover® technology
- **Treatment Innovation:** Behind-the-teeth invisible orthodontic treatment
- **Competitive Advantage:** 6-12 month treatment cycles vs traditional 18-24 months
- **Business Model:** B2B serving orthodontists and dental practices
- **Technology:** Patented biomechanical system for independent tooth movement

**Key Business Metrics:**
- Treatment duration: 6-12 months (55% faster than traditional methods)
- Patient visits: 4-6 visits vs 12-24 for traditional methods
- Treatment complexity: Simple to comprehensive cases
- Market position: Premium invisible orthodontic solutions

---

## 📅 Time-Aware Analysis Framework

### **Current Date & Time Context**
```
UTC ISO Datetime: ${new Date().toISOString()}
Central Time (Business): {{iso_datetime}} converted to UTC-6
Business Hours: 8:00 AM - 6:00 PM Central Time
Current Status: [WITHIN/OUTSIDE] business hours
```

### **Time-Based Analysis Patterns**

**⏰ Business Hours Analysis (8 AM - 6 PM Central Time)**
- **Operational Insights:** Consider business hours for operational metrics
- **Response Timing:** Account for staff availability and response patterns
- **Appointment Scheduling:** Align with orthodontic practice schedules
- **Emergency vs Routine:** Differentiate urgent vs standard requests

**📊 Treatment Cycle Awareness (6-12 Month Timelines)**
- **Progress Tracking:** Monitor treatment milestones within accelerated timelines
- **Appointment Intervals:** Understand 4-6 visit scheduling patterns
- **Seasonal Patterns:** Account for back-to-school and summer break cycles
- **Retention Phase:** Post-treatment monitoring and follow-up

**📈 Operational Patterns**
- **Weekday vs Weekend:** Manufacturing and clinical operations patterns
- **Monthly Cycles:** Revenue recognition and treatment planning cycles
- **Quarterly Reviews:** Business performance and clinical outcome assessments
- **Annual Trends:** Market seasonality and growth patterns

---

## 🎯 Four Core Business Intelligence Domains

### 1. 📦 ORDERS & COMMERCE

**Database Focus:** [`orders`](database-schema.md#orders), [`payments`](database-schema.md#payments), [`purchases`](database-schema.md#purchases), [`shipments`](database-schema.md#shipments)

**Key Time Column Strategy:**
- **PRIMARY:** Use [`orders.submitted_at`](database-schema.md#orders) for actual order timing analysis
- **SECONDARY:** Use [`orders.created_at`](database-schema.md#orders) only for system tracking
- **CRITICAL:** Always filter by [`orders.submitted_at`](database-schema.md#orders) for business intelligence

**Analysis Capabilities:**
```sql
-- Example: Revenue analysis using correct time column
SELECT 
  DATE_TRUNC('month', submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as month_ct,
  COUNT(*) as orders_count,
  SUM(amount) as total_revenue,
  AVG(amount) as avg_order_value
FROM orders 
WHERE submitted_at IS NOT NULL 
  AND deleted = false
  AND submitted_at >= NOW() - INTERVAL '12 months'
GROUP BY month_ct
ORDER BY month_ct DESC;
```

**Business Intelligence Focus:**
- Revenue trends and forecasting
- Order lifecycle analysis (submitted → approved → shipped → delivered)
- Treatment package pricing optimization
- Payment processing and collection metrics
- Shipping and fulfillment efficiency
- Customer lifetime value analysis

### 2. ⚙️ OPERATIONS

**Database Focus:** [`technicians`](database-schema.md#technicians), [`tasks`](database-schema.md#tasks), [`templates`](database-schema.md#templates), [`team_communications`](database-schema.md#team_communications)

**Operational Metrics:**
```sql
-- Example: Technician performance analysis
SELECT 
  t.first_name || ' ' || t.last_name as technician_name,
  tr.role_type,
  COUNT(tasks.id) as tasks_completed,
  AVG(EXTRACT(EPOCH FROM (tasks.completed_at - tasks.assigned_at))/3600) as avg_completion_hours,
  tasks.quality_score as avg_quality_score
FROM technicians t
JOIN technician_roles tr ON t.id = tr.technician_id
JOIN tasks ON tasks.assigned_to = t.profile_id
WHERE tasks.status = 'completed'
  AND tasks.completed_at >= NOW() - INTERVAL '30 days'
GROUP BY t.id, tr.role_type;
```

**Analysis Capabilities:**
- Technician performance and productivity metrics
- Task completion rates and quality scores
- Manufacturing workflow optimization
- Quality control and defect analysis
- Resource allocation and capacity planning
- Team communication effectiveness

### 3. 🏥 CLINICAL

**Database Focus:** [`cases`](database-schema.md#cases), [`treatment_plans`](database-schema.md#treatment_plans), [`patients`](database-schema.md#patients), [`doctors`](database-schema.md#doctors), [`jaws`](database-schema.md#jaws)

**Clinical Intelligence:**
```sql
-- Example: Treatment complexity and outcome analysis
SELECT 
  c.complexity,
  COUNT(*) as case_count,
  AVG(c.actual_duration_months) as avg_treatment_months,
  AVG(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) as success_rate,
  d.specialty as doctor_specialty
FROM cases c
JOIN doctors d ON c.primary_doctor_id = d.id
WHERE c.treatment_start_date >= NOW() - INTERVAL '24 months'
GROUP BY c.complexity, d.specialty
ORDER BY case_count DESC;
```

**Analysis Capabilities:**
- Treatment plan effectiveness and outcomes
- Case complexity distribution and success rates
- Patient journey analysis (consultation → retention)
- Doctor performance and specialization metrics
- Treatment duration vs complexity correlation
- Clinical protocol optimization

### 4. 🎧 CUSTOMER SERVICE

**Database Focus:** [`messages`](database-schema.md#messages), [`case_messages`](database-schema.md#case_messages), [`customer_feedback`](database-schema.md#customer_feedback), [`treatment_discussions`](database-schema.md#treatment_discussions)

**Sentiment and Support Analysis:**
```sql
-- Example: Customer feedback sentiment analysis
SELECT 
  cf.feedback_type,
  cf.severity,
  COUNT(*) as feedback_count,
  AVG(cf.response_time_hours) as avg_response_time,
  AVG(CASE WHEN cf.customer_satisfied THEN 1 ELSE 0 END) as satisfaction_rate
FROM customer_feedback cf
WHERE cf.created_at >= NOW() - INTERVAL '6 months'
GROUP BY cf.feedback_type, cf.severity
ORDER BY feedback_count DESC;
```

**Analysis Capabilities:**
- Customer satisfaction and sentiment tracking
- Support ticket resolution efficiency
- Communication pattern analysis
- Treatment-related concerns and feedback
- Doctor-patient communication effectiveness
- Quality issue identification and resolution

---

## 🤖 Agent Enhancement Strategy

### **Business Intelligence Agent Enhancements**

**Core Prompt Additions:**
```typescript
const BUSINESS_INTELLIGENCE_INSTRUCTIONS = `You are an advanced Database Analysis and Business Intelligence Agent with comprehensive PostgreSQL expertise and MCP tool integration.

**📅 CURRENT DATE & TIME CONTEXT**

**⏰ TIME-AWARE ANALYSIS**
- Consider business hours (8 AM - 6 PM Central Time) for operational insights
- Account for weekday vs weekend patterns in data analysis
- Use current date context for trend analysis and forecasting
- Apply time-based filtering for recent vs historical data comparisons
- ADJUST TIME FOR COMPARISONS TO CENTRAL TIME (00:00 Central Time UTC-6) based on the following UTC current time.

UTC ISO Datetime: {{iso_datetime}}

**🏥 ORTHODONTIC BUSINESS EXPERTISE**

You specialize in Brius Technologies' orthodontic treatment operations:

**Business Context:**
- Brius Technologies: Orthodontic technology company
- Primary Product: Brava System (lingual braces with Independent Mover® technology)
- Treatment Innovation: Behind-the-teeth invisible orthodontic treatment
- Competitive Advantage: 6-12 month treatment cycles vs traditional 18-24 months
- Business Model: B2B serving orthodontists and dental practices

**🎯 FOUR CORE ANALYSIS DOMAINS**

1. **📦 ORDERS & COMMERCE**
   - CRITICAL: Always use orders.submitted_at (NOT created_at) for business timing analysis
   - Revenue trends, order lifecycle, payment processing
   - Treatment package optimization and pricing analysis

2. **⚙️ OPERATIONS** 
   - Technician performance, task management, quality control
   - Manufacturing workflow optimization and capacity planning

3. **🏥 CLINICAL**
   - Treatment plans, case complexity, patient journey analysis
   - Doctor performance, treatment outcomes, protocol optimization

4. **🎧 CUSTOMER SERVICE**
   - Message analysis, sentiment tracking, feedback processing
   - Support efficiency and customer satisfaction metrics

**🔍 DATABASE SCHEMA EXPERTISE**

Key Tables and Relationships:
- orders: Use submitted_at for timing, track course_type and status
- cases: Monitor complexity, treatment duration, and outcomes  
- patients: Track journey from consultation to retention
- technicians: Analyze performance and role effectiveness
- messages/feedback: Process sentiment and support metrics

**⏰ TREATMENT CYCLE AWARENESS**
- Standard Treatment: 6-12 months (Brius advantage vs 18-24 traditional)
- Appointment Pattern: 4-6 visits vs 12-24 traditional
- Progress Milestones: Initial → Active → Refinement → Retention
- Seasonal Considerations: Back-to-school, summer breaks, holidays

**🕐 BUSINESS HOURS INTELLIGENCE**
- Operating Hours: 8 AM - 6 PM Central Time (UTC-6)
- Peak Operations: Weekday business hours
- Emergency Protocols: After-hours urgent cases
- Appointment Scheduling: Align with orthodontic practice patterns

You automatically handle the complexity of orthodontic business intelligence through your sophisticated planner-executor architecture, ensuring both strategic depth and operational precision.`;
```

### **Default Agent Enhancements**

**Smart Escalation Logic:**
```typescript
const DEFAULT_AGENT_INSTRUCTIONS = `You are a helpful and efficient business assistant specialized in handling straightforward queries and tasks for Brius Technologies' orthodontic operations.

**📅 CURRENT DATE & TIME CONTEXT**

UTC ISO Datetime: {{iso_datetime}}
Central Time (Business): Convert to UTC-6 for business context
Business Hours: 8 AM - 6 PM Central Time

**🏥 ORTHODONTIC BUSINESS CONTEXT**

You support Brius Technologies operations:
- Orthodontic technology company specializing in lingual braces
- Brava System: Behind-the-teeth invisible treatment (6-12 months vs traditional 18-24)
- B2B model serving orthodontists and dental practices
- Four core domains: Orders & Commerce, Operations, Clinical, Customer Service

**⏰ TIME-AWARE RESPONSES**
- Consider current Central Time for business hour context
- Understand orthodontic treatment cycles (6-12 months)
- Account for appointment scheduling patterns (4-6 visits)
- Recognize seasonal orthodontic trends

## Your Role & Specialization
You handle **simple, direct business questions** that don't require complex analysis:
- General orthodontic terminology and process questions
- Basic order status and timeline inquiries  
- Simple appointment and scheduling questions
- Treatment process explanations and patient guidance
- Basic operational status updates
- Direct data lookups and simple calculations

## When to Escalate vs. Handle Directly

### ✅ Handle Directly (Your Expertise):
- "What is the Brava System and how does it work?"
- "How long does typical Brius treatment take?"
- "What's the status of order #BR-2024-001?"
- "When is my next appointment scheduled?"
- "How do I care for my lingual braces?"
- "What are the office hours for Dr. Smith's practice?"
- "Can you explain the treatment phases?"

### 🔄 Suggest Escalation (Complex Analysis Needed):
- Revenue analysis across multiple time periods
- Technician performance and productivity metrics
- Treatment outcome analysis and success rates
- Patient satisfaction trends and sentiment analysis
- Operational efficiency and capacity planning
- Clinical protocol optimization recommendations
- Multi-factor correlation studies across domains
- Predictive modeling for treatment or business outcomes

## Escalation Protocol
When you encounter complex analytical requests:
1. Acknowledge the complexity and orthodontic context
2. Explain why deeper analysis would provide better insights
3. Suggest: "This question would benefit from our advanced orthodontic business intelligence capabilities. Would you like me to route this to our specialized analysis system?"
4. Offer to help with any simpler aspects of the question in the meantime

**🔍 BASIC DATABASE AWARENESS**
- Understand that orders.submitted_at is used for timing (not created_at)
- Know the four core domains for proper escalation
- Recognize treatment complexity levels and case types
- Understand basic orthodontic workflow stages

You're designed to be fast, efficient, and helpful for everyday orthodontic business needs while ensuring complex analytical work gets the specialized attention it deserves.`;
```

---

## 📊 Implementation Examples

### **Revenue Analysis Query (Orders & Commerce)**
```sql
-- Monthly revenue trends with Central Time conversion
SELECT 
  DATE_TRUNC('month', submitted_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') as month_central,
  course_type,
  COUNT(*) as order_count,
  SUM(amount) as total_revenue,
  AVG(amount) as avg_order_value,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders
FROM orders 
WHERE submitted_at IS NOT NULL 
  AND deleted = false
  AND submitted_at >= (NOW() - INTERVAL '12 months')
GROUP BY month_central, course_type
ORDER BY month_central DESC, total_revenue DESC;
```

### **Treatment Outcome Analysis (Clinical)**
```sql
-- Treatment success rates by complexity and doctor
SELECT 
  c.complexity,
  CONCAT(p.first_name, ' ', p.last_name) as doctor_name,
  COUNT(*) as total_cases,
  COUNT(CASE WHEN c.status = 'completed' THEN 1 END) as completed_cases,
  ROUND(COUNT(CASE WHEN c.status = 'completed' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as success_rate,
  AVG(c.actual_duration_months) as avg_duration_months
FROM cases c
JOIN doctors d ON c.primary_doctor_id = d.id
JOIN profiles p ON d.profile_id = p.id
WHERE c.treatment_start_date >= (NOW() - INTERVAL '24 months')
GROUP BY c.complexity, doctor_name
HAVING COUNT(*) >= 5  -- Minimum case volume for statistical significance
ORDER BY success_rate DESC, total_cases DESC;
```

### **Technician Performance Analysis (Operations)**
```sql
-- Technician productivity with quality metrics
SELECT 
  CONCAT(t.first_name, ' ', t.last_name) as technician_name,
  tr.role_type,
  COUNT(tasks.id) as tasks_completed,
  AVG(tasks.quality_score) as avg_quality_score,
  AVG(EXTRACT(EPOCH FROM (tasks.completed_at - tasks.assigned_at))/3600) as avg_completion_hours,
  COUNT(CASE WHEN tasks.quality_score >= 90 THEN 1 END) as high_quality_tasks
FROM technicians t
JOIN technician_roles tr ON t.id = tr.technician_id
JOIN tasks ON tasks.assigned_to = t.profile_id
WHERE tasks.status = 'completed'
  AND tasks.completed_at >= (NOW() - INTERVAL '30 days')
  AND t.is_active = true
GROUP BY technician_name, tr.role_type
ORDER BY avg_quality_score DESC, tasks_completed DESC;
```

### **Customer Satisfaction Analysis (Customer Service)**
```sql
-- Customer feedback sentiment with response efficiency
SELECT 
  cf.feedback_type,
  cf.severity,
  COUNT(*) as feedback_count,
  AVG(cf.response_time_hours) as avg_response_hours,
  COUNT(CASE WHEN cf.customer_satisfied = true THEN 1 END) as satisfied_count,
  ROUND(COUNT(CASE WHEN cf.customer_satisfied = true THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as satisfaction_rate,
  COUNT(CASE WHEN cf.resulted_in_remake = true THEN 1 END) as remake_count
FROM customer_feedback cf
WHERE cf.created_at >= (NOW() - INTERVAL '6 months')
GROUP BY cf.feedback_type, cf.severity
ORDER BY feedback_count DESC, satisfaction_rate ASC;
```

---

## 🚀 Advanced Features

### **Time Zone Conversion Functions**
```sql
-- Convert UTC to Central Time for business analysis
CREATE OR REPLACE FUNCTION utc_to_central(utc_timestamp TIMESTAMPTZ)
RETURNS TIMESTAMPTZ AS $$
BEGIN
  RETURN utc_timestamp AT TIME ZONE 'America/Chicago';
END;
$$ LANGUAGE plpgsql;

-- Check if timestamp falls within business hours (8 AM - 6 PM CT)
CREATE OR REPLACE FUNCTION is_business_hours(utc_timestamp TIMESTAMPTZ)
RETURNS BOOLEAN AS $$
DECLARE
  central_time TIMESTAMPTZ;
  hour_of_day INTEGER;
  day_of_week INTEGER;
BEGIN
  central_time := utc_timestamp AT TIME ZONE 'America/Chicago';
  hour_of_day := EXTRACT(HOUR FROM central_time);
  day_of_week := EXTRACT(DOW FROM central_time); -- 0=Sunday, 6=Saturday
  
  RETURN (day_of_week BETWEEN 1 AND 5) AND (hour_of_day BETWEEN 8 AND 17);
END;
$$ LANGUAGE plpgsql;
```

### **Treatment Cycle Analysis**
```sql
-- Analyze treatment progress within Brius 6-12 month cycles
WITH treatment_progress AS (
  SELECT 
    c.id,
    c.case_number,
    c.complexity,
    c.treatment_start_date,
    c.estimated_duration_months,
    c.actual_duration_months,
    CASE 
      WHEN c.status = 'completed' THEN c.actual_duration_months
      ELSE EXTRACT(MONTH FROM AGE(NOW(), c.treatment_start_date))
    END as current_duration_months,
    CASE
      WHEN c.estimated_duration_months <= 6 THEN 'Fast Track'
      WHEN c.estimated_duration_months <= 12 THEN 'Standard Brius'
      ELSE 'Complex Case'
    END as treatment_category
  FROM cases c
  WHERE c.treatment_start_date IS NOT NULL
)
SELECT 
  treatment_category,
  complexity,
  COUNT(*) as case_count,
  AVG(current_duration_months) as avg_current_duration,
  AVG(estimated_duration_months) as avg_estimated_duration,
  COUNT(CASE WHEN current_duration_months <= estimated_duration_months THEN 1 END) as on_track_count
FROM treatment_progress
GROUP BY treatment_category, complexity
ORDER BY treatment_category, complexity;
```

---

## 📋 Quality Assurance & Testing

### **Prompt Validation Checklist**

**✅ Time Awareness**
- [ ] Correctly converts UTC to Central Time (UTC-6)
- [ ] Recognizes business hours (8 AM - 6 PM CT)
- [ ] Understands orthodontic treatment cycles (6-12 months)
- [ ] Accounts for seasonal patterns in orthodontic practice

**✅ Database Schema Compliance**
- [ ] Uses `orders.submitted_at` for timing analysis (NOT `created_at`)
- [ ] Properly joins related tables with foreign key relationships
- [ ] Handles NULL values and deleted records appropriately
- [ ] Applies proper filtering for business logic

**✅ Domain Expertise**
- [ ] Demonstrates understanding of Brius Technologies business model
- [ ] Uses correct orthodontic terminology and concepts
- [ ] Recognizes treatment complexity levels and case types
- [ ] Understands lingual brace technology and advantages

**✅ Escalation Logic**
- [ ] Default agent properly identifies complex analytical requests
- [ ] Business Intelligence agent handles sophisticated analysis
- [ ] Clear handoff protocols between agents
- [ ] Maintains context during escalation

### **Performance Metrics**

**Response Quality Indicators:**
- Accuracy of time zone conversions
- Proper use of `submitted_at` vs `created_at` columns
- Relevance of orthodontic business context
- Effectiveness of domain-specific analysis

**User Experience Metrics:**
- Query resolution time
- Escalation appropriateness
- Answer completeness and accuracy
- User satisfaction with orthodontic expertise

---

## 🔄 Continuous Improvement

### **Feedback Integration**
- Monitor query patterns for new domain requirements
- Track escalation accuracy and user satisfaction
- Identify gaps in orthodontic business knowledge
- Refine time-aware analysis based on usage patterns

### **Schema Evolution**
- Adapt to database schema changes
- Incorporate new orthodontic business metrics
- Enhance domain-specific analysis capabilities
- Optimize query performance for large datasets

---

## 📚 References

- [Brius Technologies Company Information](https://brius.com)
- [Database Schema Documentation](database-schema.md)
- [Mastra Agent Architecture](../src/mastra/agents/)
- [Time Zone Handling Best Practices](time-zones.md)
- [Orthodontic Industry Standards](orthodontic-standards.md)

---

**Document Maintained By:** Brius Technologies Engineering Team  
**Last Updated:** October 22, 2025  
**Next Review:** January 22, 2026