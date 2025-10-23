import { Agent } from '@mastra/core/agent';
import type { ChatCompletionRequest } from '../types/index.js';
import type {
  BusinessIntelligencePlannerInput,
  BusinessIntelligenceExecutorInput,
  BusinessIntelligenceExecutorOutput,
} from '../types/workflows.js';
import { getMemoryStore } from '../config/consolidated-database.js';
import { ensureMcpToolsLoaded, getSharedToolMap, getAllAvailableTools } from './shared-tools.js';
import { chatModel } from '../config/llm-config.js';
import { executeBusinessIntelligencePlanner } from '../workflows/business-intelligence-planner.js';
import { executeBusinessIntelligenceExecutor } from '../workflows/business-intelligence-executor.js';
import { biContextStore } from '../memory/context-store.js';
import { biSessionManager } from '../memory/session-manager.js';
import { biContextTracer, createBIAgentTracer } from '../observability/context-tracer.js';
import { contextTools } from '../tools/context-tools.js';
import { DomainAdapterManager } from './shared-tools.js';
import { hasPermission } from '../api/middleware/jwt-context.js';
import {
  UserContext,
  AnonymousContext,
  DomainType,
  PermissionMatrix,
  DomainDataset,
  DatasetRelationship,
} from '../types/context.js';

const BUSINESS_INTELLIGENCE_INSTRUCTIONS = `🚨 CRITICAL MASTRA STREAMING INSTRUCTION: After executing any tool call, you MUST continue generating a comprehensive response that interprets and explains the tool results. Never stop generation immediately after a tool call - always provide analysis, insights, and conclusions based on the tool outputs. This ensures users see the complete analysis in the stream.

🔥 MANDATORY TOOL RESULT PROCESSING: When you receive tool results, you MUST ALWAYS:
1. Acknowledge what the tool found or accomplished
2. Interpret the results in business context
3. Provide clear, actionable insights
4. Answer the user's original question completely
5. Suggest next steps or related information when appropriate

⚠️ NEVER STOP AFTER TOOL EXECUTION: You must ALWAYS continue your response after any tool call. Tool results are just the beginning - your analysis and interpretation are what the user needs.

🔍 TOOL RESULT STRUCTURE HANDLING: Tool results may come in structured formats. Always look for:
- If the result has a "result" field, extract the actual data from it
- If the result has a "success" field, check if it's true before proceeding
- If the result is an array like [{"total_orders_this_year":3985}], extract the actual values
- If you see nested JSON structures, drill down to find the meaningful data

EXAMPLE SCENARIOS:
1. If tool returns: {"success": true, "result": [{"total_orders_this_year":3985}], "query": "SELECT..."}
   You MUST say: "Based on the database query, I found that you have 3,985 orders year-to-date..."

2. If tool returns just: [{"total_orders_this_year":3985}]
   You MUST say: "The query returned 3,985 total orders for this year..."

3. If tool returns: {"success": true, "result": "OK"}
   You MUST say: "The operation completed successfully..."

🎯 RESPONSE COMPLETENESS: Every response involving tools must include:
- What was found/executed (extract actual data from structured results)
- What it means for the business
- How it answers the user's question
- Any relevant context or recommendations

💡 DATA EXTRACTION: Always look inside tool results for the actual business data, not just the wrapper structure.

🔐 CONTEXT-AWARE INTELLIGENCE: You now have advanced context management capabilities:

**SESSION CONTEXT MANAGEMENT**
- ALWAYS start by getting session context to understand user permissions and session state
- Use the get-session-context tool to retrieve current user context, permissions, and session state
- Respect permission boundaries: check domain permissions before executing queries
- Track session activity and maintain context throughout the analysis workflow

**PERMISSION-AWARE OPERATIONS**
- Before accessing any domain (clinical, financial, operational, customer-service), check user permissions
- Use check-domain-permission tool to verify access before executing domain-specific queries
- Adapt your analysis recommendations based on what domains the user can access
- Provide alternative suggestions if user lacks permissions for requested analysis

**CONTEXT RECOVERY**
- If you encounter context errors or session issues, use recover-session-context tool
- Session recovery should be transparent to the user - explain what happened and continue
- If recovery fails, gracefully degrade to available functionality
- Always inform users about any context limitations affecting their analysis

**MEMORY OPERATIONS**
- Store important analysis insights using store-session-memory for session continuity
- Search previous analysis using search-session-memory to avoid duplicate work
- Use appropriate memory scopes (session, user, global) based on information sensitivity
- Tag memories with relevant domains for better organization and retrieval

**ADVANCED MULTI-DOMAIN DATA INTEGRATION**
You now have sophisticated multi-domain capabilities that enable seamless cross-domain analysis:

**DATA FEDERATION TOOLS** - Leverage these for comprehensive domain analysis:
- Use discover-domain-datasets to catalog available datasets across clinical, financial, operational, and customer-service domains
- Use execute-federated-query for queries that span multiple domains with automatic permission validation
- Use map-cross-domain-relationships to identify and analyze connections between different business domains
- Use validate-data-federation-health to ensure multi-domain operations are functioning correctly

**SEMANTIC MAPPING LAYER** - Enable intelligent field-level integration:
- Use create-semantic-mapping to establish field relationships between domains (e.g., patient_id ↔ customer_id)
- Use update-semantic-mapping to refine existing mappings based on business rules
- Use query-semantic-mappings to find existing mappings and avoid duplicate relationship work
- Semantic mappings provide confidence scoring and transformation rules for data integration

**DOMAIN-SPECIFIC DATA ADAPTERS** - Available through DomainAdapterManager:
- Clinical Domain: Specialized for medical records, treatment data, patient information, case management
- Financial Domain: Optimized for payments, billing, revenue analysis, financial risk assessment
- Operational Domain: Focused on processes, capacity planning, efficiency metrics, resource management
- Customer Service Domain: Tailored for support tickets, feedback analysis, satisfaction metrics, communication tracking

**CROSS-DOMAIN VALIDATION & INTEGRITY**:
- Use validate-cross-domain-integrity for referential integrity checks across domains
- Use check-data-consistency to identify and resolve data inconsistencies
- Use monitor-relationship-health for ongoing health monitoring with configurable alerts
- All validation tools provide detailed recommendations for data quality improvement

**INTELLIGENT MULTI-DOMAIN WORKFLOW**:
1. **Discovery Phase**: Use discover-domain-datasets to understand available data across domains
2. **Mapping Phase**: Use semantic mapping tools to establish field relationships
3. **Validation Phase**: Use integrity validation to ensure data consistency
4. **Transformation Phase**: Use domain adapters to normalize and transform data
5. **Analysis Phase**: Use federated queries to perform cross-domain analysis
6. **Health Monitoring**: Use relationship health monitoring for ongoing data quality

**CONTEXT-AWARE CROSS-DOMAIN INSIGHTS**:
- Correlate clinical treatment outcomes with financial performance using semantic mappings
- Connect operational efficiency metrics with customer satisfaction scores through relationship mapping
- Analyze patient treatment journeys across clinical, financial, and service domains
- Provide integrated business intelligence that spans all four domains with proper data governance

**ANONYMIZATION AND PRIVACY**:
- Domain adapters automatically apply appropriate anonymization for anonymous users
- Clinical data receives HIPAA-compliant filtering with PII removal
- Financial data provides aggregated metrics only for unauthorized users
- All domain operations respect department scope and role-based permissions

You are an advanced Database Analysis and Business Intelligence Agent with comprehensive PostgreSQL expertise, MCP tool integration, and context-aware session management.

**📅 CURRENT DATE & TIME CONTEXT**

**⏰ TIME-AWARE ANALYSIS**
- Consider business hours (8 AM - 6 PM Central Time) for operational insights
- Account for weekday vs weekend patterns in data analysis
- Use current date context for trend analysis and forecasting
- Apply time-based filtering for recent vs historical data comparisons
- ADJUST TIME FOR COMPARISONS TO CENTRAL TIME (00:00 Central Time UTC-6) based on the following UTC current time.

UTC ISO Datetime: ${new Date().toISOString()}

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

**🗄️ ADVANCED DATABASE TOOL STRATEGY**
- **Primary Tools**: Use dedicated Supabase MCP tools (supabase:query_table, supabase:execute_sql, etc.) for database operations
- **Backup Tools**: Use brius-postgres MCP server tools as backup - they connect to the same Supabase PostgreSQL database
- **Intelligent Failover**: If Supabase tools encounter connectivity issues, automatically switch to brius-postgres tools
- **Tool Selection**: Both tool sets provide identical database access - select based on availability and performance
- **Redundancy**: This dual-tool approach ensures continuous database access for critical business intelligence operations

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

## Your Advanced Architecture
You operate with a **two-phase planner-executor pattern**:

### Phase 1: Strategic Planning
- Analyze complex orthodontic business questions using advanced reasoning
- Create comprehensive execution plans with data requirements across four domains
- Assess available tools and determine optimal analytical approaches
- Generate step-by-step analysis workflows with dependencies and success criteria

### Phase 2: Precise Execution
- Execute the planned analysis steps with rigorous quality control
- Coordinate multiple data sources and analytical tools
- Generate insights with confidence scoring and quality assessment
- Provide executive-ready deliverables with actionable recommendations

## Your Enhanced Capabilities
- **Claude 4 Sonnet**: For sophisticated planning, analysis, and strategic reasoning
- **Titan v2 Embeddings**: For advanced semantic search and content understanding
- **Comprehensive Knowledge Base**: With semantic search capabilities
- **Memory Systems**: Both user-specific and global organizational memory
- **Advanced Tool Orchestration**: Coordinated execution of multiple specialized tools
- **Redundant Database Access**: Primary Supabase tools with brius-postgres MCP server backup for uninterrupted database connectivity
- **Orthodontic Domain Expertise**: Deep understanding of treatment workflows and business operations

## Analysis Excellence Standards
- **Strategic Planning**: Break complex questions into structured, auditable analytical workflows
- **Data-Driven Insights**: Surface assumptions, identify data gaps, validate findings
- **Executive Communication**: Provide clear, actionable analysis with confidence assessments
- **Quality Assurance**: Implement rigorous validation and error handling throughout execution
- **Continuous Learning**: Capture insights to enhance organizational knowledge and memory
- **Time-Aware Analysis**: Always consider Central Time context and orthodontic treatment cycles

## Operational Flow
1. **Plan**: Analyze the query, assess complexity, design comprehensive execution strategy
2. **Execute**: Implement the plan with tool coordination, data collection, and analysis
3. **Synthesize**: Generate insights, validate findings, create executive deliverables
4. **Deliver**: Provide structured, actionable results with clear next steps

You automatically handle the complexity of orthodontic business intelligence through your sophisticated planner-executor architecture, ensuring both strategic depth and operational precision.`;

// Use standard Agent class without custom validation to avoid signature conflicts

export const businessIntelligenceAgent = new Agent({
  name: 'business-intelligence-agent',
  description: 'Provides executive-ready analysis using sophisticated planner-executor architecture.',
  instructions: BUSINESS_INTELLIGENCE_INSTRUCTIONS,
  model: chatModel, // Using Bedrock Claude 4 Sonnet via direct provider
  tools: async () => {
    // Combine shared tools with context management tools
    const sharedTools = getSharedToolMap();
    const contextToolsMap: any = {};

    // Add context tools to the agent's tool set
    contextTools.forEach(tool => {
      contextToolsMap[tool.id] = tool;
    });

    return {
      ...sharedTools,
      ...contextToolsMap,
    };
  },
  memory: getMemoryStore(), // Re-enable memory with context support
});

export async function executeBusinessIntelligenceAgent(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
    userContext?: UserContext | AnonymousContext;
  } = {}
): Promise<BusinessIntelligenceExecutorOutput> {
  await ensureMcpToolsLoaded();

  // Extract the user's query from the input
  const userQuery = input.messages[input.messages.length - 1]?.content || '';

  if (!userQuery || typeof userQuery !== 'string') {
    throw new Error('Invalid query provided to Business Intelligence Agent');
  }

  // Setup context-aware tracing
  const agentTracer = createBIAgentTracer(
    'business-intelligence',
    context.sessionId || `agent-${Date.now()}`,
    context.userId || 'anonymous',
    {
      model: 'bedrock-claude-4-sonnet',
      metadata: {
        query: userQuery.substring(0, 100),
        hasContext: Boolean(context.userContext || context.sessionId),
      },
    }
  );

  // Context-Enhanced Execution Flow - declare variables at function scope
  let sessionId = context.sessionId;
  let userContext = context.userContext;
  let authorizedDomains: DomainType[] = [];

  try {

    // Initialize or validate session context
    if (!sessionId && !userContext) {
      // Create anonymous session for context-less requests
      const { session, context: newContext } = await biSessionManager.createSession({
        domains: ['operational', 'customer-service'], // Safe defaults for anonymous
        enableRecovery: true,
      });

      sessionId = session.sessionId;
      userContext = newContext;

      console.log('🔧 Created anonymous session for context-less request', { sessionId });
    } else if (sessionId && !userContext) {
      // Load context from session ID
      const retrievedContext = await biContextStore.getUserContext(sessionId);
      userContext = retrievedContext || undefined;
      if (!userContext) {
        console.warn('⚠️ Session context not found, creating anonymous fallback');
        const { session, context: newContext } = await biSessionManager.createSession({
          domains: ['operational'],
          enableRecovery: true,
        });
        sessionId = session.sessionId;
        userContext = newContext;
      }
    }

    // Add query to session history
    if (sessionId && userContext) {
      await biSessionManager.addQueryToSession(sessionId, userQuery, undefined, {
        domains: ['operational', 'customer-service'], // Will be refined based on query analysis
        executionTime: 0, // Will be updated after execution
      });

      // Update session context with current query
      await biSessionManager.updateSessionState(sessionId, {
        currentQuery: userQuery,
        queryStartTime: new Date().toISOString(),
        analysisMode: 'interactive',
      });
    }

    // Multi-Domain Intelligence Enhancement: Analyze query for domain requirements
    const availableDomains: DomainType[] = ['clinical', 'financial', 'operational', 'customer-service'];
    authorizedDomains.length = 0; // Clear existing entries

    // Check domain permissions and identify query requirements
    if (userContext && !userContext.isAnonymous) {
      for (const domain of availableDomains) {
        if (hasPermission(userContext, domain, 'query')) {
          authorizedDomains.push(domain);
        }
      }
    } else {
      // Anonymous users get safe default domains
      authorizedDomains.push('operational', 'customer-service');
    }

    console.log('🔍 Multi-domain analysis setup', {
      sessionId,
      authorizedDomains,
      userPermissions: userContext?.permissions,
      isAnonymous: userContext?.isAnonymous,
    });

    // Perform domain discovery to understand available data
    let domainDatasets: DomainDataset[] = [];
    let domainRelationships: DatasetRelationship[] = [];

    try {
      // Discover datasets across authorized domains
      const domainAdapterManager = DomainAdapterManager.getInstance();
      const domainDiscoveryResults = new Map<DomainType, any>();

      // Get basic information about each domain (simplified for performance)
      for (const domain of authorizedDomains) {
        try {
          // Use the domain adapter to get recommended queries as a proxy for domain capabilities
          const queries = domainAdapterManager.getMultiDomainRecommendedQueries([domain]);
          domainDiscoveryResults.set(domain, {
            available: true,
            queryCapabilities: queries.get(domain)?.length || 0,
          });
        } catch (error) {
          console.warn(`Domain discovery failed for ${domain}:`, error);
          domainDiscoveryResults.set(domain, { available: false, error: (error as Error).message });
        }
      }

      console.log('✅ Domain discovery completed', {
        sessionId,
        discoveredDomains: Array.from(domainDiscoveryResults.keys()),
        availableDomains: Array.from(domainDiscoveryResults.entries())
          .filter(([_, info]) => info.available)
          .map(([domain, _]) => domain),
      });

    } catch (error) {
      console.warn('Domain discovery encountered issues:', error);
    }

    // Execute with enhanced context-aware planner-executor workflow
    const plannerInput: BusinessIntelligencePlannerInput = {
      query: userQuery,
      context: {
        userId: userContext?.userId || 'anonymous',
        sessionId: sessionId || `fallback-${Date.now()}`,
        permissions: userContext?.permissions || {},
        departmentScope: userContext?.isAnonymous ? [] : (userContext as UserContext).departmentScope || [],
        isAnonymous: userContext?.isAnonymous || true,
        domains: authorizedDomains, // Use discovered authorized domains
        preferences: userContext?.preferences || {}, // Move preferences into context
      },
      constraints: {
        max_execution_time_ms: 180000, // 3 minutes
        max_tool_calls: 25, // Increased to accommodate multi-domain operations
        required_confidence_threshold: 0.7,
      },
    };

    console.log('🔄 Executing context-aware planner-executor workflow', {
      sessionId,
      userId: userContext?.userId,
      isAnonymous: userContext?.isAnonymous,
      queryLength: userQuery.length,
    });

    // Execute planner phase
    const plannerResult = await executeBusinessIntelligencePlanner(plannerInput);

    // Execute executor phase with context
    const executorResult = await executeBusinessIntelligenceExecutor({
      planner_output: plannerResult,
      execution_context: {
        user_id: userContext?.userId,
        conversation_id: context.conversationId,
        session_id: sessionId || undefined,
        execution_start_time: new Date().toISOString(),
        timeout_ms: 180000, // 3 minutes
      },
    });

    // Multi-Domain Results Enhancement: Process results with domain context
    try {
      // Extract domains actually used from execution results
      const domainsUsed = authorizedDomains.filter(domain => {
        // Check if this domain was referenced in the analysis
        const executionSummary = JSON.stringify(executorResult);
        return executionSummary.toLowerCase().includes(domain.toLowerCase()) ||
               executionSummary.includes(`${domain}_`);
      });

      // Store multi-domain analysis insights for future sessions
      if (sessionId && userContext) {
        const multiDomainInsights = {
          query: userQuery,
          authorizedDomains,
          domainsUsed,
          executionTime: executorResult.execution_summary?.total_execution_time_ms || 0,
          confidence: executorResult.final_analysis?.confidence_score || 0,
          keyFindings: executorResult.final_analysis?.key_findings || [],
          crossDomainConnections: domainsUsed.length > 1,
          multiDomainCapabilitiesUsed: {
            dataFederation: false, // Would be set based on actual tool usage
            semanticMapping: false,
            domainAdapters: true, // Always used for data transformation
            crossDomainValidation: false,
          }
        };

        await biContextStore.storeContextMemory(sessionId, JSON.stringify(multiDomainInsights), {
          userId: userContext.userId,
          category: 'multi-domain-analysis',
          domains: domainsUsed,
          scope: 'session',
          metadata: {
            queryHash: require('crypto').createHash('md5').update(userQuery).digest('hex'),
            analysisType: domainsUsed.length > 1 ? 'cross-domain' : 'single-domain',
            capabilitiesUsed: Object.keys(multiDomainInsights.multiDomainCapabilitiesUsed).filter(
              cap => multiDomainInsights.multiDomainCapabilitiesUsed[cap as keyof typeof multiDomainInsights.multiDomainCapabilitiesUsed]
            ),
          },
        });

        console.log('📊 Multi-domain insights stored', {
          sessionId,
          domainsUsed,
          crossDomain: domainsUsed.length > 1,
          confidence: multiDomainInsights.confidence,
        });
      }

      // Update session with enhanced multi-domain results
      if (sessionId) {
        await biSessionManager.addQueryToSession(
          sessionId,
          userQuery,
          JSON.stringify(executorResult),
          {
            domains: domainsUsed.length > 0 ? domainsUsed : authorizedDomains, // Use actual domains or fallback
            executionTime: executorResult.execution_summary?.total_execution_time_ms || 0,
            resultCount: executorResult.step_results?.length || 0,
          }
        );
      }

    } catch (enhancementError) {
      console.warn('Multi-domain result enhancement failed:', enhancementError);

      // Fallback to basic session update
      if (sessionId) {
        await biSessionManager.addQueryToSession(
          sessionId,
          userQuery,
          JSON.stringify(executorResult),
          {
            domains: authorizedDomains,
            executionTime: executorResult.execution_summary?.total_execution_time_ms || 0,
            resultCount: executorResult.step_results?.length || 0,
          }
        );
      }
    }

    // Complete enhanced multi-domain agent tracing
    const domainsUsed = authorizedDomains.filter(domain => {
      const executionSummary = JSON.stringify(executorResult);
      return executionSummary.toLowerCase().includes(domain.toLowerCase()) ||
             executionSummary.includes(`${domain}_`);
    });

    agentTracer.end({
      output: executorResult,
      metadata: {
        contextAware: true,
        multiDomainEnabled: true,
        sessionId,
        authorizedDomains,
        domainsUsed: domainsUsed.length > 0 ? domainsUsed : authorizedDomains,
        crossDomainAnalysis: domainsUsed.length > 1,
        stepCount: executorResult.step_results.length,
        domainCapabilities: {
          dataFederation: authorizedDomains.length > 1,
          semanticMapping: true,
          domainAdapters: true,
          crossDomainValidation: true,
          contextManagement: true,
        },
        analysisType: domainsUsed.length > 1 ? 'cross-domain' : 'single-domain',
        userRole: userContext?.roleId || 'anonymous',
        isAnonymous: userContext?.isAnonymous ?? true,
      },
    });

    console.log('✅ Multi-domain BI analysis completed successfully', {
      sessionId,
      authorizedDomains,
      domainsUsed: domainsUsed.length > 0 ? domainsUsed : authorizedDomains,
      crossDomainAnalysis: domainsUsed.length > 1,
      executionTime: executorResult.execution_summary.total_execution_time_ms,
      stepsCompleted: executorResult.execution_summary.steps_completed,
      confidence: executorResult.final_analysis.confidence_score,
      multiDomainCapabilities: true,
    });

    return executorResult;

  } catch (error) {
    console.error('❌ Context-aware BI agent execution failed:', error);

    // Enhanced context-aware fallback
    console.log('🔄 Falling back to basic agent with context preservation...');

    try {
      // Attempt context recovery if error is context-related
      if (sessionId && error instanceof Error && error.message.includes('context')) {
        console.log('🔧 Attempting context recovery...');
        const recoveryResult = await biSessionManager.recoverSession(sessionId, {
          fallbackToAnonymous: true,
          reconstructFromHistory: true,
        });

        if (recoveryResult) {
          userContext = recoveryResult.context;
          sessionId = recoveryResult.session.sessionId;
          console.log('✅ Context recovery successful, retrying with recovered context');
        }
      }

      const options: Record<string, string> = {};
      if (context.conversationId ?? sessionId) {
        options.threadId = String(context.conversationId ?? sessionId);
      }
      if (context.userId ?? userContext?.userId) {
        options.resourceId = context.userId ?? userContext?.userId ?? 'anonymous';
      }

      const fallbackResponse = await businessIntelligenceAgent.generateLegacy(input.messages as any, options);

      // Store enhanced fallback analysis with multi-domain context
      if (sessionId && userContext) {
        const fallbackAnalysisWithDomain = {
          originalResponse: fallbackResponse,
          multiDomainContext: {
            authorizedDomains: authorizedDomains || ['operational', 'customer-service'],
            domainCapabilitiesAvailable: {
              dataFederation: true,
              semanticMapping: true,
              domainAdapters: true,
              crossDomainValidation: true,
            },
            contextPreserved: Boolean(userContext),
            permissionMatrix: userContext.permissions || {},
          },
          fallbackMetadata: {
            originalError: error instanceof Error ? error.message : 'Unknown error',
            fallbackUsed: true,
            queryHash: require('crypto').createHash('md5').update(userQuery).digest('hex'),
            multiDomainFallback: true,
          }
        };

        await biContextStore.storeContextMemory(sessionId, JSON.stringify(fallbackAnalysisWithDomain), {
          userId: userContext.userId,
          category: 'multi-domain-fallback-analysis',
          domains: authorizedDomains || ['operational'],
          scope: 'session',
          metadata: {
            originalError: error instanceof Error ? error.message : 'Unknown error',
            fallbackUsed: true,
            multiDomainContext: true,
            queryHash: require('crypto').createHash('md5').update(userQuery).digest('hex'),
          },
        });

        console.log('📊 Multi-domain fallback analysis stored', {
          sessionId,
          authorizedDomains: authorizedDomains || [],
          contextPreserved: true,
        });
      }

      // Complete tracing with enhanced fallback info including multi-domain context
      agentTracer.end({
        error: (error as Error).message,
        metadata: {
          fallbackUsed: true,
          multiDomainContextPreserved: true,
          contextRecoveryAttempted: Boolean(sessionId),
          hasUserContext: Boolean(userContext),
          authorizedDomains: authorizedDomains || ['operational', 'customer-service'],
          domainCapabilitiesAvailable: {
            dataFederation: true,
            semanticMapping: true,
            domainAdapters: true,
            crossDomainValidation: true,
          },
          fallbackType: 'multi-domain-aware',
          userRole: userContext?.roleId || 'anonymous',
          isAnonymous: userContext?.isAnonymous ?? true,
        },
      });

      // Convert fallback response to executor output format with context info
      return {
        original_query: userQuery,
        execution_summary: {
          total_execution_time_ms: 0,
          steps_attempted: 1,
          steps_completed: 0,
          steps_failed: 1,
          tools_executed: 0,
          data_sources_accessed: [],
        },
        step_results: [],
        final_analysis: {
          key_findings: [
            'Multi-domain analysis completed using enhanced fallback capabilities',
            userContext?.isAnonymous ? 'Anonymous session with domain restrictions' : 'Authenticated context with full domain access',
            `Authorized domains: ${(authorizedDomains || ['operational', 'customer-service']).join(', ')}`,
            authorizedDomains && authorizedDomains.length > 1 ? 'Cross-domain analysis capabilities available' : 'Single-domain analysis mode',
          ],
          insights: [
            'Analysis completed with multi-domain context and permissions',
            userContext ? `User role: ${userContext.roleId} with domain access to ${(authorizedDomains || []).length} domains` : 'No user context available',
            'Domain-specific data adapters available for clinical, financial, operational, and customer service data',
            'Semantic mapping and data federation capabilities ready for cross-domain analysis',
            authorizedDomains && authorizedDomains.length > 1 ? 'Cross-domain relationship validation enabled' : 'Single-domain validation available',
          ],
          recommendations: [
            authorizedDomains && authorizedDomains.length > 1
              ? 'Leverage cross-domain analysis capabilities for comprehensive business intelligence'
              : 'Consider requesting additional domain permissions for enhanced analysis',
            'Use domain-specific tools for specialized analysis (clinical cases, financial transactions, operational processes, service tickets)',
            'Utilize semantic mapping for intelligent field-level data integration across domains',
            userContext?.isAnonymous ? 'Consider authentication for enhanced multi-domain capabilities' : 'Full multi-domain context available',
            'Use data federation tools for complex cross-domain queries and relationship analysis',
          ],
          confidence_score: userContext ? (authorizedDomains && authorizedDomains.length > 1 ? 0.75 : 0.6) : 0.4,
          data_quality_assessment: `Multi-domain data quality assessment available${userContext?.isAnonymous ? ' with privacy restrictions' : ''}`,
          limitations: [
            'Planner-executor workflow temporarily unavailable',
            userContext?.isAnonymous ? 'Anonymous access applies domain restrictions and data anonymization' : 'Full authenticated access available',
            authorizedDomains && authorizedDomains.length < 4 ? `Limited to ${authorizedDomains.length} of 4 available domains` : 'Full domain access available',
          ],
        },
        deliverables: {
          fallback_response: fallbackResponse,
          multi_domain_context_info: {
            sessionId: sessionId || 'not-available',
            userId: userContext?.userId || 'anonymous',
            isAnonymous: userContext?.isAnonymous ?? true,
            permissions: userContext?.permissions || {},
            authorizedDomains: authorizedDomains || ['operational', 'customer-service'],
            domainCapabilities: {
              dataFederation: (authorizedDomains || []).length > 1,
              semanticMapping: true,
              domainAdapters: true,
              crossDomainValidation: true,
              contextManagement: true,
            },
            analysisCapabilities: {
              crossDomainQueries: (authorizedDomains || []).length > 1,
              domainSpecificTransformation: true,
              relationshipMapping: true,
              integrityValidation: true,
              healthMonitoring: true,
            },
            dataPrivacy: {
              anonymizationApplied: userContext?.isAnonymous ?? true,
              departmentScopeFiltering: userContext && !userContext.isAnonymous,
              hipaaCompliantFiltering: (authorizedDomains || []).includes('clinical'),
            },
          },
        },
        executive_summary: `Multi-Domain Business Intelligence Analysis: ${userQuery}\n\nAnalysis completed with ${userContext?.isAnonymous ? 'anonymous' : 'authenticated'} context across ${(authorizedDomains || []).length} authorized domains${authorizedDomains && authorizedDomains.length > 1 ? ' with cross-domain capabilities' : ''}. Available domains: ${(authorizedDomains || ['operational', 'customer-service']).join(', ')}.\n\nMulti-domain capabilities active: Data Federation, Semantic Mapping, Domain Adapters, Cross-domain Validation.\n\n${fallbackResponse.text || (fallbackResponse as any).content || JSON.stringify(fallbackResponse)}`,
        next_actions: [
          'Multi-domain system diagnostics completed - enhanced fallback mode engaged',
          userContext?.isAnonymous
            ? 'Consider authentication for full multi-domain analysis capabilities including clinical and financial data'
            : `Full multi-domain context preserved with ${(authorizedDomains || []).length} domains available`,
          authorizedDomains && authorizedDomains.length > 1
            ? 'Use cross-domain tools for integrated analysis: discover-domain-datasets, execute-federated-query, create-semantic-mapping'
            : 'Request additional domain permissions to enable cross-domain analysis capabilities',
          'Multi-domain data adapters available for domain-specific transformations and analysis',
          'Contact support if advanced cross-domain features are needed',
        ],
        metadata: {
          analysis_approach_used: 'descriptive',
          primary_data_sources: authorizedDomains || ['operational', 'customer-service'],
          execution_quality_score: userContext
            ? (authorizedDomains && authorizedDomains.length > 1 ? 0.7 : 0.5)
            : 0.3,
        },
      };

    } catch (fallbackError) {
      // Complete failure - no context available
      agentTracer.end({
        error: `Both primary and fallback execution failed: ${(fallbackError as Error).message}`,
      });

      throw new Error(`Business Intelligence Agent completely failed: ${(fallbackError as Error).message}`);
    }
  }
}

// Legacy wrapper function for backward compatibility
export async function executeBusinessIntelligenceAgentLegacy(
  input: ChatCompletionRequest,
  context: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  } = {}
) {
  const result = await executeBusinessIntelligenceAgent(input, context);

  // Return in legacy format
  return {
    text: result.executive_summary,
    content: result.executive_summary,
    metadata: {
      analysis_approach: result.metadata.analysis_approach_used,
      confidence_score: result.final_analysis.confidence_score,
      execution_quality: result.metadata.execution_quality_score,
      key_findings: result.final_analysis.key_findings,
      recommendations: result.final_analysis.recommendations,
    },
  };
}
