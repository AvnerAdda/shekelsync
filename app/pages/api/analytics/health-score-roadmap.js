import pool from '../db';

/**
 * Health Score Roadmap API
 * Generates a personalized improvement plan to boost financial health score
 * Shows current score, target score, and ranked actions with impact calculations
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { targetScore = 85, months = 6 } = req.query;
    const targetScoreInt = parseInt(targetScore);
    const monthsInt = parseInt(months);

    // Get current health score breakdown from the intelligence API
    const intelligenceResponse = await fetch(
      `http://localhost:${process.env.PORT || 3000}/api/analytics/personal-intelligence?months=${monthsInt}`
    );
    
    if (!intelligenceResponse.ok) {
      throw new Error('Failed to fetch current health score');
    }

    const intelligenceData = await intelligenceResponse.json();
    const currentScore = intelligenceData.overallHealthScore || 0;
    const healthBreakdown = intelligenceData.healthBreakdown || {};

    // Get opportunities from Phase 3
    const opportunitiesResponse = await fetch(
      `http://localhost:${process.env.PORT || 3000}/api/analytics/category-opportunities?months=${monthsInt}`
    );
    
    const opportunitiesData = await opportunitiesResponse.json();
    const opportunities = opportunitiesData.opportunities || [];

    // Get recurring patterns from Phase 2
    const recurringResponse = await fetch(
      `http://localhost:${process.env.PORT || 3000}/api/analytics/recurring-analysis?months=${monthsInt}`
    );
    
    const recurringData = await recurringResponse.json();
    const recurringPatterns = recurringData.recurring_patterns || [];

    // Generate improvement actions
    const actions = generateImprovementActions(
      currentScore,
      healthBreakdown,
      opportunities,
      recurringPatterns
    );

    // Calculate roadmap to target score
    const roadmap = calculateRoadmap(currentScore, targetScoreInt, actions);

    const response = {
      current_score: currentScore,
      target_score: targetScoreInt,
      gap: targetScoreInt - currentScore,
      health_breakdown: healthBreakdown,
      improvement_actions: actions,
      roadmap: roadmap,
      estimated_timeframe: estimateTimeframe(actions),
      summary: {
        total_actions: actions.length,
        high_impact_actions: actions.filter(a => a.impact >= 10).length,
        total_potential_points: actions.reduce((sum, a) => sum + a.impact, 0),
        achievability: calculateAchievability(currentScore, targetScoreInt, actions)
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error generating health score roadmap:', error);
    res.status(500).json({ 
      error: 'Failed to generate roadmap', 
      details: error.message 
    });
  }
}

/**
 * Generate ranked improvement actions based on current state
 */
function generateImprovementActions(currentScore, healthBreakdown, opportunities, recurringPatterns) {
  const actions = [];

  // Parse health breakdown components
  const components = healthBreakdown.components || [];
  
  // 1. Actions from health score components (what's currently low)
  components.forEach(component => {
    const score = component.score || 0;
    const weight = component.weight || 0;
    
    if (score < 70) {
      // This component needs improvement
      const potentialGain = ((70 - score) / 100) * weight;
      
      actions.push({
        id: `improve_${component.name.toLowerCase().replace(/\s+/g, '_')}`,
        category: 'health_component',
        title: `Improve ${component.name}`,
        description: getComponentImprovement(component.name, score),
        current_value: score,
        target_value: Math.min(score + 20, 100),
        impact: Math.round(potentialGain),
        difficulty: getDifficulty(component.name, score),
        timeframe: getTimeframe(component.name),
        action_items: getComponentActionItems(component.name)
      });
    }
  });

  // 2. Actions from spending opportunities (Phase 3)
  opportunities.slice(0, 5).forEach((opp, index) => {
    const scoreImpact = calculateOpportunityImpact(opp);
    
    actions.push({
      id: `optimize_${opp.category_definition_id}`,
      category: 'spending_optimization',
      title: `Optimize ${opp.category_name} Spending`,
      description: `Reduce spending in ${opp.category_name} from ₪${Math.round(opp.spending_summary.avg_monthly_spending)}/mo`,
      current_value: opp.spending_summary.avg_monthly_spending,
      target_value: opp.spending_summary.avg_monthly_spending * 0.85, // 15% reduction
      impact: scoreImpact,
      difficulty: opp.actionability_level === 'high' ? 'easy' : 'medium',
      timeframe: '1-2 months',
      action_items: opp.suggestions[0]?.action_items || [],
      related_opportunity: opp
    });
  });

  // 3. Actions from recurring patterns (Phase 2)
  recurringPatterns
    .filter(p => p.optimization_suggestions && p.optimization_suggestions.length > 0)
    .slice(0, 3)
    .forEach(pattern => {
      const suggestion = pattern.optimization_suggestions[0];
      const scoreImpact = Math.round(pattern.monthly_equivalent / 100);

      actions.push({
        id: `recurring_${pattern.merchant_pattern.replace(/\s+/g, '_')}`,
        category: 'recurring_optimization',
        title: `Optimize ${pattern.merchant_pattern}`,
        description: suggestion.title,
        current_value: pattern.monthly_equivalent,
        target_value: pattern.monthly_equivalent - suggestion.potential_savings,
        impact: scoreImpact,
        difficulty: 'medium',
        timeframe: '1 month',
        action_items: [suggestion.action],
        related_recurring: pattern
      });
    });

  // 4. General financial health actions (always applicable)
  if (currentScore < 80) {
    actions.push({
      id: 'build_emergency_fund',
      category: 'savings',
      title: 'Build Emergency Fund',
      description: 'Establish or increase emergency savings to 3-6 months of expenses',
      current_value: 0,
      target_value: 1,
      impact: 8,
      difficulty: 'hard',
      timeframe: '6-12 months',
      action_items: [
        'Calculate 3-6 months of essential expenses',
        'Set up automatic savings transfer',
        'Start with ₪500/month if possible',
        'Keep in high-yield savings account'
      ]
    });
  }

  if (currentScore < 75) {
    actions.push({
      id: 'track_spending_consistently',
      category: 'habits',
      title: 'Track Spending Consistently',
      description: 'Review transactions weekly and categorize accurately',
      current_value: 0,
      target_value: 1,
      impact: 5,
      difficulty: 'easy',
      timeframe: '1 month',
      action_items: [
        'Set weekly reminder to review transactions',
        'Categorize all transactions accurately',
        'Review monthly spending trends',
        'Adjust budget based on actuals'
      ]
    });
  }

  // Sort by impact (descending)
  actions.sort((a, b) => b.impact - a.impact);

  return actions;
}

/**
 * Get improvement description for health component
 */
function getComponentImprovement(componentName, currentScore) {
  const lower = componentName.toLowerCase();
  
  if (lower.includes('temporal') || lower.includes('rhythm')) {
    return `Your spending timing patterns score is ${currentScore}/100. Improve consistency and reduce end-of-month spikes.`;
  }
  if (lower.includes('behavioral') || lower.includes('impulse')) {
    return `Your spending behavior score is ${currentScore}/100. Reduce impulsive purchases and increase planned spending.`;
  }
  if (lower.includes('comparative') || lower.includes('benchmark')) {
    return `Your spending is above typical benchmarks. Aim to reduce spending in high-cost categories.`;
  }
  if (lower.includes('efficiency')) {
    return `Your spending efficiency score is ${currentScore}/100. Optimize value-for-money in purchases.`;
  }
  if (lower.includes('predictive') || lower.includes('stability')) {
    return `Your spending predictability score is ${currentScore}/100. Establish more consistent spending patterns.`;
  }
  
  return `This aspect of your financial health scores ${currentScore}/100 and has room for improvement.`;
}

/**
 * Get difficulty level for improving a component
 */
function getDifficulty(componentName, currentScore) {
  const lower = componentName.toLowerCase();
  const gap = 70 - currentScore;
  
  if (gap > 30) return 'hard';
  if (gap > 15) return 'medium';
  return 'easy';
}

/**
 * Get estimated timeframe for component improvement
 */
function getTimeframe(componentName) {
  const lower = componentName.toLowerCase();
  
  if (lower.includes('habits') || lower.includes('behavioral')) {
    return '2-3 months'; // Habit changes take time
  }
  if (lower.includes('emergency') || lower.includes('savings')) {
    return '6-12 months'; // Building savings is long-term
  }
  return '1-2 months'; // Most other improvements
}

/**
 * Get action items for improving a health component
 */
function getComponentActionItems(componentName) {
  const lower = componentName.toLowerCase();
  
  if (lower.includes('temporal') || lower.includes('rhythm')) {
    return [
      'Distribute spending evenly throughout the month',
      'Avoid end-of-month spending spikes',
      'Plan major purchases in advance',
      'Set up recurring payments early in month'
    ];
  }
  if (lower.includes('behavioral') || lower.includes('impulse')) {
    return [
      'Implement 24-hour rule for non-essential purchases',
      'Create shopping lists before buying',
      'Unsubscribe from promotional emails',
      'Track emotional triggers for spending'
    ];
  }
  if (lower.includes('comparative') || lower.includes('benchmark')) {
    return [
      'Review spending vs. income ratio',
      'Identify categories above typical benchmarks',
      'Set category-specific budgets',
      'Research average costs in your area'
    ];
  }
  if (lower.includes('efficiency')) {
    return [
      'Compare prices before major purchases',
      'Look for quality products that last longer',
      'Use coupons and cashback when available',
      'Buy in bulk for frequently used items'
    ];
  }
  
  return [
    'Review this area weekly',
    'Set specific improvement goals',
    'Track progress monthly',
    'Adjust strategy as needed'
  ];
}

/**
 * Calculate score impact of implementing an opportunity
 */
function calculateOpportunityImpact(opportunity) {
  // Higher spending + higher opportunity score = bigger impact
  const monthlySpending = opportunity.spending_summary.avg_monthly_spending;
  const oppScore = opportunity.opportunity_score;
  
  // Score impact based on potential savings as % of total spending
  const potentialSavings = opportunity.suggestions.reduce(
    (sum, s) => sum + (s.potential_savings || 0), 
    0
  );
  
  // Each ₪100 saved per month = ~1 point improvement
  const baseImpact = Math.round(potentialSavings / 100);
  
  // Multiply by opportunity score factor (0.5-1.0)
  const scoreFactor = oppScore / 100;
  
  return Math.max(1, Math.round(baseImpact * scoreFactor));
}

/**
 * Calculate roadmap to reach target score
 */
function calculateRoadmap(currentScore, targetScore, actions) {
  const gap = targetScore - currentScore;
  
  if (gap <= 0) {
    return {
      status: 'achieved',
      message: 'You have already achieved or exceeded your target score!',
      recommended_actions: []
    };
  }

  // Select minimum set of actions needed to reach target
  let cumulativeImpact = 0;
  const selectedActions = [];
  
  // Prioritize by impact/difficulty ratio
  const rankedActions = [...actions].sort((a, b) => {
    const scoreA = a.impact / (a.difficulty === 'easy' ? 1 : a.difficulty === 'medium' ? 2 : 3);
    const scoreB = b.impact / (b.difficulty === 'easy' ? 1 : b.difficulty === 'medium' ? 2 : 3);
    return scoreB - scoreA;
  });

  for (const action of rankedActions) {
    if (cumulativeImpact >= gap) break;
    
    selectedActions.push({
      ...action,
      cumulative_score: currentScore + cumulativeImpact + action.impact
    });
    
    cumulativeImpact += action.impact;
  }

  const phases = groupActionsIntoPhases(selectedActions);

  return {
    status: cumulativeImpact >= gap ? 'achievable' : 'challenging',
    message: cumulativeImpact >= gap 
      ? `You can reach ${targetScore} by completing ${selectedActions.length} key actions`
      : `Reaching ${targetScore} requires ${gap} points. Available actions provide ${cumulativeImpact} points.`,
    recommended_actions: selectedActions,
    phases: phases,
    estimated_final_score: Math.min(100, currentScore + cumulativeImpact)
  };
}

/**
 * Group actions into phases (quick wins, medium-term, long-term)
 */
function groupActionsIntoPhases(actions) {
  return {
    phase_1: {
      name: 'Quick Wins (Month 1)',
      actions: actions.filter(a => a.difficulty === 'easy' || a.timeframe.includes('1 month')),
      total_impact: actions
        .filter(a => a.difficulty === 'easy' || a.timeframe.includes('1 month'))
        .reduce((sum, a) => sum + a.impact, 0)
    },
    phase_2: {
      name: 'Medium-Term (Months 2-3)',
      actions: actions.filter(a => a.difficulty === 'medium' && !a.timeframe.includes('1 month')),
      total_impact: actions
        .filter(a => a.difficulty === 'medium' && !a.timeframe.includes('1 month'))
        .reduce((sum, a) => sum + a.impact, 0)
    },
    phase_3: {
      name: 'Long-Term (Months 4+)',
      actions: actions.filter(a => a.difficulty === 'hard'),
      total_impact: actions
        .filter(a => a.difficulty === 'hard')
        .reduce((sum, a) => sum + a.impact, 0)
    }
  };
}

/**
 * Estimate timeframe to complete all actions
 */
function estimateTimeframe(actions) {
  const difficulties = actions.map(a => a.difficulty);
  const hasHard = difficulties.includes('hard');
  const hasMedium = difficulties.includes('medium');
  
  if (hasHard) return '6-12 months';
  if (hasMedium && actions.length > 5) return '3-6 months';
  if (hasMedium) return '2-3 months';
  return '1-2 months';
}

/**
 * Calculate how achievable the target is
 */
function calculateAchievability(currentScore, targetScore, actions) {
  const gap = targetScore - currentScore;
  const totalPotential = actions.reduce((sum, a) => sum + a.impact, 0);
  
  if (totalPotential >= gap * 1.5) return 'highly_achievable';
  if (totalPotential >= gap) return 'achievable';
  if (totalPotential >= gap * 0.7) return 'challenging';
  return 'very_challenging';
}
