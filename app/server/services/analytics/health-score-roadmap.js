const personalIntelligenceService = require('./personal-intelligence.js');
const categoryOpportunitiesService = require('./category-opportunities.js');
const recurringAnalysisService = require('./recurring-analysis.js');

function getComponentImprovement(name, score) {
  if (name === 'Savings Rate') {
    return `Increase savings rate from ${Math.round(score)} to at least 70 by automating transfers and cutting discretionary spend.`;
  }
  if (name === 'Spending Diversity') {
    return 'Diversify your spending by reducing reliance on your top expense categories.';
  }
  if (name === 'Impulse Control') {
    return 'Reduce impulse purchases by introducing a 24-hour waiting rule for discretionary buys.';
  }
  if (name === 'Financial Runway') {
    return 'Build financial runway to cover at least 3 months of expenses through targeted savings.';
  }
  return 'Focus on improving this component through consistent budgeting and review.';
}

function getDifficulty(name, score) {
  if (name === 'Savings Rate' && score < 50) return 'hard';
  if (name === 'Impulse Control' && score < 60) return 'medium';
  return 'medium';
}

function getTimeframe(name) {
  if (name === 'Savings Rate') return '3-6 months';
  if (name === 'Financial Runway') return '6-12 months';
  return '1-2 months';
}

function getComponentActionItems(name) {
  if (name === 'Savings Rate') {
    return [
      'Automate monthly savings transfer immediately after payday',
      'Review discretionary spending categories for 15% reduction',
      'Increase income through side work or salary negotiation',
    ];
  }
  if (name === 'Impulse Control') {
    return [
      'Introduce 24-hour rule for purchases above ₪300',
      'Limit shopping app notifications to once per day',
      'Review spending weekly to identify impulse trends',
    ];
  }
  return [
    'Set clear monthly target for this metric',
    'Track progress weekly and adjust budget accordingly',
    'Celebrate milestones to maintain momentum',
  ];
}

function calculateOpportunityImpact(opportunity) {
  const reduction = opportunity.spending_summary?.avg_monthly_spending || 0;
  const potentialSavings = reduction * 0.15;
  return Math.min(20, Math.round(potentialSavings / 150));
}

function calculateAchievability(currentScore, targetScore, actions) {
  if (!actions.length) return 'low';
  const totalImpact = actions.reduce((sum, action) => sum + (action.impact || 0), 0);
  const scoreGap = targetScore - currentScore;

  if (totalImpact >= scoreGap) return 'high';
  if (totalImpact >= scoreGap * 0.6) return 'medium';
  return 'low';
}

function estimateTimeframe(actions) {
  if (!actions.length) return 'No actions required';
  const hardestAction = actions.reduce((max, action) => {
    if (action.difficulty === 'hard') return '6-12 months';
    if (action.difficulty === 'medium' && max !== '6-12 months') return '3-6 months';
    return max === '6-12 months' ? max : '1-3 months';
  }, '1-3 months');
  return hardestAction;
}

function generateImprovementActions(currentScore, healthBreakdown, opportunities, recurringPatterns) {
  const actions = [];
  const components = healthBreakdown.components || [];

  components.forEach((component) => {
    const score = component.score || 0;
    const weight = component.weight || 0;

    if (score < 70) {
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
        action_items: getComponentActionItems(component.name),
      });
    }
  });

  opportunities.slice(0, 5).forEach((opp) => {
    const scoreImpact = calculateOpportunityImpact(opp);
    const firstSuggestion = opp.suggestions?.[0];
    actions.push({
      id: `optimize_${opp.category_definition_id}`,
      category: 'spending_optimization',
      title: `Optimize ${opp.category_name} Spending`,
      description: `Reduce spending in ${opp.category_name} from ₪${Math.round(
        opp.spending_summary.avg_monthly_spending,
      )}/mo`,
      current_value: opp.spending_summary.avg_monthly_spending,
      target_value: opp.spending_summary.avg_monthly_spending * 0.85,
      impact: scoreImpact,
      difficulty: opp.actionability_level === 'high' ? 'easy' : 'medium',
      timeframe: '1-2 months',
      action_items:
        (firstSuggestion?.action_items && firstSuggestion.action_items.length > 0
          ? firstSuggestion.action_items
          : firstSuggestion?.recommended_action
            ? [firstSuggestion.recommended_action]
            : []),
      related_opportunity: opp,
    });
  });

  recurringPatterns
    .filter((p) => p.optimization_suggestions && p.optimization_suggestions.length > 0)
    .slice(0, 3)
    .forEach((pattern) => {
      const suggestion = pattern.optimization_suggestions[0];
      const scoreImpact = Math.round(pattern.monthly_equivalent / 100);

      actions.push({
        id: `recurring_${pattern.merchant_pattern.replace(/\s+/g, '_')}`,
        category: 'recurring_optimization',
        title: `Optimize ${pattern.merchant_pattern}`,
        description: suggestion.title,
        current_value: pattern.monthly_equivalent,
        target_value: pattern.monthly_equivalent - (suggestion.potential_savings || 0),
        impact: scoreImpact,
        difficulty: 'medium',
        timeframe: '1 month',
        action_items: [suggestion.action],
        related_recurring: pattern,
      });
    });

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
        'Keep in high-yield savings account',
      ],
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
        'Adjust budget based on actuals',
      ],
    });
  }

  return actions;
}

function calculateRoadmap(currentScore, targetScore, actions) {
  const gap = targetScore - currentScore;

  if (gap <= 0) {
    return {
      status: 'achieved',
      message: 'You have already achieved or exceeded your target score!',
      recommended_actions: [],
      phases: createEmptyPhases(),
      estimated_final_score: currentScore,
    };
  }

  const rankedActions = [...actions].sort((a, b) => {
    const scoreA =
      (a.impact || 0) / (a.difficulty === 'easy' ? 1 : a.difficulty === 'medium' ? 2 : 3);
    const scoreB =
      (b.impact || 0) / (b.difficulty === 'easy' ? 1 : b.difficulty === 'medium' ? 2 : 3);
    return scoreB - scoreA;
  });

  const selectedActions = [];
  let cumulativeImpact = 0;

  for (const action of rankedActions) {
    if (cumulativeImpact >= gap) break;

    cumulativeImpact += action.impact || 0;
    selectedActions.push({
      ...action,
      cumulative_score: Math.min(100, currentScore + cumulativeImpact),
    });
  }

  const phases = groupActionsIntoPhases(selectedActions);
  const status = cumulativeImpact >= gap ? 'achievable' : 'challenging';
  const message =
    status === 'achievable'
      ? `You can reach ${targetScore} by completing ${selectedActions.length} key actions`
      : `Reaching ${targetScore} requires ${gap} points. Available actions provide ${cumulativeImpact} points.`;

  return {
    status,
    message,
    recommended_actions: selectedActions,
    phases,
    estimated_final_score: Math.min(100, currentScore + cumulativeImpact),
  };
}

function createEmptyPhases() {
  return {
    phase_1: { name: 'Quick Wins (Month 1)', actions: [], total_impact: 0 },
    phase_2: { name: 'Medium-Term (Months 2-3)', actions: [], total_impact: 0 },
    phase_3: { name: 'Long-Term (Months 4+)', actions: [], total_impact: 0 },
  };
}

function groupActionsIntoPhases(actions) {
  const phases = createEmptyPhases();

  actions.forEach((action) => {
    if (action.difficulty === 'hard') {
      phases.phase_3.actions.push(action);
      phases.phase_3.total_impact += action.impact || 0;
    } else if (action.difficulty === 'medium' && !action.timeframe.includes('1 month')) {
      phases.phase_2.actions.push(action);
      phases.phase_2.total_impact += action.impact || 0;
    } else {
      phases.phase_1.actions.push(action);
      phases.phase_1.total_impact += action.impact || 0;
    }
  });

  return phases;
}

function translateAchievabilityLabel(label) {
  switch (label) {
    case 'high':
      return 'highly_achievable';
    case 'medium':
      return 'achievable';
    case 'low':
      return 'challenging';
    default:
      return label || 'challenging';
  }
}

async function getHealthScoreRoadmap(params = {}) {
  const monthsInt = Math.max(parseInt(params.months, 10) || 6, 1);
  const targetScoreInt = Math.max(parseInt(params.targetScore, 10) || 85, 0);

  const personalIntelligence = await personalIntelligenceService.getPersonalIntelligence({ months: monthsInt });
  const opportunitiesData = await categoryOpportunitiesService.getCategoryOpportunities({ months: monthsInt });
  const recurringAnalysis = await recurringAnalysisService.getRecurringAnalysis({ months: monthsInt });

  const currentScore = personalIntelligence.overallHealthScore || 0;
  const healthBreakdown = {
    components: personalIntelligence.healthBreakdown
      ? Object.entries(personalIntelligence.healthBreakdown).map(([name, score]) => ({
          name,
          score,
          weight: 25,
        }))
      : [],
    ...personalIntelligence.healthBreakdown,
  };

  const actions = generateImprovementActions(
    currentScore,
    { components: healthBreakdown.components },
    opportunitiesData.opportunities || [],
    recurringAnalysis.recurring_patterns || [],
  );

  const roadmap = calculateRoadmap(currentScore, targetScoreInt, actions);

  return {
    current_score: currentScore,
    target_score: targetScoreInt,
    gap: targetScoreInt - currentScore,
    health_breakdown: personalIntelligence.healthBreakdown,
    improvement_actions: actions,
    roadmap,
    estimated_timeframe: estimateTimeframe(actions),
    summary: {
      total_actions: actions.length,
      high_impact_actions: actions.filter((a) => a.impact >= 10).length,
      total_potential_points: actions.reduce((sum, a) => sum + (a.impact || 0), 0),
      achievability: translateAchievabilityLabel(
        calculateAchievability(currentScore, targetScoreInt, actions),
      ),
    },
  };
}

module.exports = {
  getHealthScoreRoadmap,
};

module.exports.default = module.exports;
