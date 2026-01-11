/**
 * Quest System Service
 *
 * Generates gamified financial challenges based on:
 * - Forecast patterns and spending analysis
 * - Budget outlook and risk assessment
 * - Category variability types
 *
 * Supports quest lifecycle: generate → accept → track → verify
 */

const actualDatabase = require('../database.js');
const { resolveLocale, getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');
const forecastService = require('../forecast.js');

let database = actualDatabase;

// Quest System Configuration
const MAX_ACTIVE_QUESTS = 5;
const MIN_QUESTS_BEFORE_GENERATION = 3;
const STREAK_RESET_DAYS = 30;

// Level tiers: points required to reach each level
const LEVEL_TIERS = [
  { level: 1, points: 0 },
  { level: 2, points: 100 },
  { level: 3, points: 300 },
  { level: 4, points: 600 },
  { level: 5, points: 1000 },
  { level: 6, points: 1500 },
  { level: 7, points: 2200 },
  { level: 8, points: 3000 },
  { level: 9, points: 4000 },
  { level: 10, points: 5000 },
];

// Base points by quest duration (days)
const QUEST_DURATION_POINTS = {
  7: { min: 50, max: 100 },
  30: { min: 150, max: 300 },
  90: { min: 400, max: 600 },
  180: { min: 800, max: 1000 },
};

// Difficulty multipliers
const DIFFICULTY_MULTIPLIERS = {
  easy: 1.0,
  medium: 1.5,
  hard: 2.0,
};

// Quest action types
const QUEST_ACTION_TYPES = [
  'quest_reduce_spending',
  'quest_savings_target',
  'quest_budget_adherence',
  'quest_set_budget',
  'quest_reduce_fixed_cost',
  'quest_income_goal',
];

/**
 * Calculate level from total points
 */
function calculateLevel(totalPoints) {
  for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) {
    if (totalPoints >= LEVEL_TIERS[i].points) {
      return LEVEL_TIERS[i].level;
    }
  }
  return 1;
}

/**
 * Calculate points for a quest based on duration and difficulty
 */
function calculateQuestPoints(durationDays, difficulty, targetReductionPct = 0) {
  // Find closest duration tier
  const durations = Object.keys(QUEST_DURATION_POINTS).map(Number).sort((a, b) => a - b);
  let tier = durations[0];
  for (const d of durations) {
    if (durationDays >= d) tier = d;
  }
  
  const baseRange = QUEST_DURATION_POINTS[tier];
  // Scale within range based on target difficulty (higher reduction = more points)
  const scaleFactor = Math.min(1, targetReductionPct / 25); // 25% reduction = max base points
  const basePoints = baseRange.min + (baseRange.max - baseRange.min) * scaleFactor;
  
  const multiplier = DIFFICULTY_MULTIPLIERS[difficulty] || 1;
  return Math.round(basePoints * multiplier);
}

/**
 * Determine quest difficulty based on reduction target and pattern confidence
 */
function determineQuestDifficulty(reductionPct, confidence = 0.7) {
  // Higher reduction + lower confidence = harder
  const difficultyScore = (reductionPct / 100) * 2 + (1 - confidence);
  
  if (difficultyScore >= 0.6) return 'hard';
  if (difficultyScore >= 0.35) return 'medium';
  return 'easy';
}

/**
 * Get count of active/accepted quests
 */
async function getActiveQuestCount(client) {
  const result = await client.query(`
    SELECT COUNT(*) as count
    FROM smart_action_items
    WHERE action_type LIKE 'quest_%'
      AND user_status IN ('active', 'accepted')
  `);
  return parseInt(result.rows[0]?.count || 0, 10);
}

/**
 * Generate quests based on forecast patterns and spending analysis
 * Respects MAX_ACTIVE_QUESTS limit and triggers on-demand when below MIN_QUESTS_BEFORE_GENERATION
 */
async function generateQuests(params = {}) {
  const { locale, force = false, forecastData: injectedForecast } = params;
  const quests = [];

  let client;
  try {
    client = await database.getClient();

    // Check current active quest count
    const activeCount = await getActiveQuestCount(client);
    console.log('[Quests] Active quest count:', activeCount, 'MAX:', MAX_ACTIVE_QUESTS);
    if (activeCount >= MAX_ACTIVE_QUESTS && !force) {
      return {
        success: true,
        message: `Maximum active quests reached (${MAX_ACTIVE_QUESTS})`,
        created: 0,
        active_count: activeCount,
      };
    }

    const slotsAvailable = MAX_ACTIVE_QUESTS - activeCount;

    // Get forecast data
    const forecastData = injectedForecast || await forecastService.getForecast({ months: 6 });
    const patterns = forecastData?.patterns || [];
    const budgetOutlook = forecastData?.budgetOutlook || [];
    console.log('[Quests] Forecast patterns count:', patterns.length, 'Budget outlook count:', budgetOutlook.length);

    // Get spending category mappings to check variability types
    const mappingsResult = await client.query(`
      SELECT scm.category_definition_id, scm.variability_type, cd.name, cd.name_en
      FROM spending_category_mappings scm
      JOIN category_definitions cd ON scm.category_definition_id = cd.id
      WHERE cd.is_active = 1
    `);
    const variabilityMap = new Map();
    for (const row of mappingsResult.rows) {
      variabilityMap.set(row.category_definition_id, {
        variabilityType: row.variability_type,
        name: row.name,
        nameEn: row.name_en,
      });
    }

    // Quest Type 1: Reduce variable/seasonal spending
    const variablePatterns = patterns.filter(p => {
      const mapping = variabilityMap.get(p.categoryDefinitionId);
      const isActionable = !p.isFixedRecurring && !p.isFixedAmount;
      const hasEnoughHistory = (p.monthsOfHistory || 0) >= 2;
      const meaningfulSpending = (p.avgAmount || 0) >= 100;
      const isVariable = mapping?.variabilityType === 'variable' || mapping?.variabilityType === 'seasonal' || isActionable;
      return isVariable && hasEnoughHistory && meaningfulSpending;
    });
    console.log('[Quests] Variable patterns after filtering:', variablePatterns.length);

    // Sort by potential impact (higher spending = more potential savings)
    variablePatterns.sort((a, b) => (b.avgAmount || 0) - (a.avgAmount || 0));

    for (const pattern of variablePatterns.slice(0, 3)) {
      if (quests.length >= slotsAvailable) break;

      // Determine reduction target based on variance
      const cv = pattern.coefficientOfVariation || 0.3;
      const reductionPct = cv > 0.5 ? 20 : cv > 0.3 ? 15 : 10;
      const difficulty = determineQuestDifficulty(reductionPct, pattern.confidence || 0.7);
      const durationDays = reductionPct >= 20 ? 30 : 7; // Harder reductions get more time
      const points = calculateQuestPoints(durationDays, difficulty, reductionPct);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const targetAmount = Math.round((pattern.avgAmount || 0) * (1 - reductionPct / 100));

      quests.push({
        action_type: 'quest_reduce_spending',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Reduce ${localizedName} spending by ${reductionPct}%`,
        description: `Challenge: Keep your ${localizedName} spending under ₪${targetAmount} this ${durationDays === 7 ? 'week' : 'month'}. Your average is ₪${Math.round(pattern.avgAmount || 0)}.`,
        metadata: JSON.stringify({
          quest_type: 'reduce_spending',
          target_amount: targetAmount,
          current_average: pattern.avgAmount,
          reduction_pct: reductionPct,
          pattern_confidence: pattern.confidence,
          variability_type: variabilityMap.get(pattern.categoryDefinitionId)?.variabilityType || 'variable',
        }),
        completion_criteria: JSON.stringify({
          type: 'spending_limit',
          category_definition_id: pattern.categoryDefinitionId,
          target_amount: targetAmount,
          comparison: 'less_than',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.round((pattern.avgAmount || 0) * reductionPct / 100),
        detection_confidence: pattern.confidence || 0.7,
      });
    }

    // Quest Type 2: Budget adherence for at-risk categories
    const atRiskBudgets = budgetOutlook.filter(item =>
      item.budgetId &&
      (item.status === 'at_risk' || item.risk >= 0.5) &&
      item.limit > 0
    );

    for (const item of atRiskBudgets.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;

      // Already have a quest for this category?
      if (quests.find(q => q.trigger_category_id === item.categoryDefinitionId)) continue;

      const difficulty = item.risk >= 0.8 ? 'hard' : item.risk >= 0.6 ? 'medium' : 'easy';
      const durationDays = 7; // Weekly adherence check
      const points = calculateQuestPoints(durationDays, difficulty, 15);

      const localizedName = getLocalizedCategoryName({
        name: item.categoryName,
        name_en: item.categoryNameEn,
        name_fr: null,
      }, locale) || item.categoryName;

      const remainingBudget = Math.max(0, item.limit - item.actualSpent);

      quests.push({
        action_type: 'quest_budget_adherence',
        trigger_category_id: item.categoryDefinitionId,
        severity: 'medium',
        title: `Stay on budget: ${localizedName}`,
        description: `Challenge: Keep ${localizedName} within your ₪${Math.round(item.limit)} budget this week. You have ₪${Math.round(remainingBudget)} remaining.`,
        metadata: JSON.stringify({
          quest_type: 'budget_adherence',
          budget_id: item.budgetId,
          budget_limit: item.limit,
          current_spent: item.actualSpent,
          remaining: remainingBudget,
          risk_score: item.risk,
        }),
        completion_criteria: JSON.stringify({
          type: 'budget_adherence',
          category_definition_id: item.categoryDefinitionId,
          budget_id: item.budgetId,
          target_limit: item.limit,
          comparison: 'less_than_or_equal',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.max(0, item.projectedTotal - item.limit),
        detection_confidence: 0.8,
      });
    }

    // Quest Type 3: Set budget for high-variance unbudgeted categories
    const unbudgetedHighVariance = patterns.filter(p =>
      p.monthsOfHistory >= 3 &&
      p.coefficientOfVariation > 0.4 &&
      (p.avgAmount || 0) > 100 &&
      !budgetOutlook.find(b => b.categoryDefinitionId === p.categoryDefinitionId && b.budgetId)
    );

    for (const pattern of unbudgetedHighVariance.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;
      if (quests.find(q => q.trigger_category_id === pattern.categoryDefinitionId)) continue;

      const difficulty = 'easy'; // Setting a budget is easy
      const durationDays = 7;
      const points = calculateQuestPoints(durationDays, difficulty, 5);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      const suggestedBudget = Math.round((pattern.avgAmount || 0) * 1.1);

      quests.push({
        action_type: 'quest_set_budget',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Set a budget for ${localizedName}`,
        description: `Your ${localizedName} spending varies a lot (₪${Math.round(pattern.minAmount || 0)}-₪${Math.round(pattern.maxAmount || 0)}). Set a budget around ₪${suggestedBudget} to gain control.`,
        metadata: JSON.stringify({
          quest_type: 'set_budget',
          suggested_budget: suggestedBudget,
          avg_monthly: pattern.avgAmount,
          min_amount: pattern.minAmount,
          max_amount: pattern.maxAmount,
          coefficient_of_variation: pattern.coefficientOfVariation,
        }),
        completion_criteria: JSON.stringify({
          type: 'budget_exists',
          category_definition_id: pattern.categoryDefinitionId,
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: 0,
        detection_confidence: 0.9,
      });
    }

    // Quest Type 4: Reduce fixed costs (review subscriptions, insurance, etc.)
    const fixedPatterns = patterns.filter(p => {
      const mapping = variabilityMap.get(p.categoryDefinitionId);
      const isFixed = p.isFixedRecurring || p.isFixedAmount || mapping?.variabilityType === 'fixed';
      const meaningful = (p.avgAmount || 0) >= 50;
      const hasHistory = (p.monthsOfHistory || 0) >= 3;
      return isFixed && meaningful && hasHistory;
    });

    // Sort by amount (higher = more savings potential)
    fixedPatterns.sort((a, b) => (b.avgAmount || 0) - (a.avgAmount || 0));

    for (const pattern of fixedPatterns.slice(0, 2)) {
      if (quests.length >= slotsAvailable) break;
      if (quests.find(q => q.trigger_category_id === pattern.categoryDefinitionId)) continue;

      const difficulty = 'medium'; // Requires negotiation/switching
      const durationDays = 30; // Give time to find alternatives
      const points = calculateQuestPoints(durationDays, difficulty, 10);

      const localizedName = getLocalizedCategoryName({
        name: pattern.categoryName,
        name_en: pattern.categoryNameEn,
        name_fr: null,
      }, locale) || pattern.categoryName;

      quests.push({
        action_type: 'quest_reduce_fixed_cost',
        trigger_category_id: pattern.categoryDefinitionId,
        severity: 'low',
        title: `Review & reduce: ${localizedName}`,
        description: `You pay ₪${Math.round(pattern.avgAmount || 0)}/month for ${localizedName}. Review if you can find a better deal or negotiate a lower rate.`,
        metadata: JSON.stringify({
          quest_type: 'reduce_fixed_cost',
          current_amount: pattern.avgAmount,
          is_fixed_recurring: pattern.isFixedRecurring,
        }),
        completion_criteria: JSON.stringify({
          type: 'fixed_cost_reduction',
          category_definition_id: pattern.categoryDefinitionId,
          baseline_amount: pattern.avgAmount,
          comparison: 'less_than',
        }),
        quest_difficulty: difficulty,
        quest_duration_days: durationDays,
        points_reward: points,
        potential_impact: Math.round((pattern.avgAmount || 0) * 0.1), // Assume 10% savings potential
        detection_confidence: 0.7,
      });
    }

    // Quest Type 5: Savings target from under-budget surplus
    const underBudget = budgetOutlook.filter(item =>
      item.budgetId &&
      item.status === 'on_track' &&
      item.limit > 0 &&
      item.projectedTotal < item.limit * 0.7
    );

    if (underBudget.length > 0 && quests.length < slotsAvailable) {
      const totalSurplus = underBudget.reduce((sum, item) => sum + (item.limit - item.projectedTotal), 0);
      if (totalSurplus >= 100) {
        const savingsTarget = Math.round(totalSurplus * 0.5); // Target 50% of projected surplus
        const difficulty = savingsTarget >= 500 ? 'hard' : savingsTarget >= 200 ? 'medium' : 'easy';
        const durationDays = 30;
        const points = calculateQuestPoints(durationDays, difficulty, 20);

        quests.push({
          action_type: 'quest_savings_target',
          trigger_category_id: null,
          severity: 'low',
          title: `Save ₪${savingsTarget} this month`,
          description: `Based on your under-budget categories, you could save an extra ₪${savingsTarget}. Transfer this to savings before month-end.`,
          metadata: JSON.stringify({
            quest_type: 'savings_target',
            target_amount: savingsTarget,
            total_surplus: totalSurplus,
            contributing_categories: underBudget.map(item => ({
              id: item.categoryDefinitionId,
              name: item.categoryName,
              surplus: item.limit - item.projectedTotal,
            })),
          }),
          completion_criteria: JSON.stringify({
            type: 'savings_transfer',
            target_amount: savingsTarget,
            comparison: 'greater_than_or_equal',
          }),
          quest_difficulty: difficulty,
          quest_duration_days: durationDays,
          points_reward: points,
          potential_impact: savingsTarget,
          detection_confidence: 0.75,
        });
      }
    }

    // Save quests to database
    let created = 0;
    const now = new Date();
    const recurrencePrefix = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const quest of quests) {
      const recurrenceKey = `${quest.action_type}_${quest.trigger_category_id || 'global'}_${recurrencePrefix}`;

      // Check for existing quest
      const existingResult = await client.query(`
        SELECT id FROM smart_action_items
        WHERE recurrence_key = $1 AND user_status NOT IN ('resolved', 'dismissed', 'failed')
      `, [recurrenceKey]);

      if (existingResult.rows.length > 0 && !force) continue;

      await client.query(`
        INSERT INTO smart_action_items (
          action_type, trigger_category_id, severity, title, description,
          metadata, completion_criteria, quest_difficulty, quest_duration_days,
          points_reward, potential_impact, detection_confidence, recurrence_key, is_recurring
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0)
      `, [
        quest.action_type,
        quest.trigger_category_id,
        quest.severity,
        quest.title,
        quest.description,
        quest.metadata,
        quest.completion_criteria,
        quest.quest_difficulty,
        quest.quest_duration_days,
        quest.points_reward,
        quest.potential_impact,
        quest.detection_confidence,
        recurrenceKey,
      ]);

      created++;
    }

    return {
      success: true,
      total_generated: quests.length,
      created,
      active_count: activeCount + created,
      slots_remaining: slotsAvailable - created,
    };
  } catch (error) {
    console.error('Failed to generate quests:', error);
    return { success: false, error: error.message };
  } finally {
    if (client) client.release();
  }
}

/**
 * Accept a quest - sets deadline and marks as accepted
 */
async function acceptQuest(questId) {
  const client = await database.getClient();

  try {
    // Get the quest
    const questResult = await client.query(`
      SELECT * FROM smart_action_items WHERE id = $1
    `, [questId]);

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.action_type.startsWith('quest_')) {
      throw new Error('This action item is not a quest');
    }

    if (quest.user_status !== 'active') {
      throw new Error(`Quest cannot be accepted (current status: ${quest.user_status})`);
    }

    // Check active quest limit
    const activeCount = await getActiveQuestCount(client);
    if (activeCount >= MAX_ACTIVE_QUESTS) {
      throw new Error(`Maximum active quests reached (${MAX_ACTIVE_QUESTS})`);
    }

    // Calculate deadline
    const now = new Date();
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + (quest.quest_duration_days || 7));

    await client.query(`
      UPDATE smart_action_items
      SET user_status = 'accepted',
          accepted_at = datetime('now'),
          deadline = $2
      WHERE id = $1
    `, [questId, deadline.toISOString()]);

    // Add to history
    await client.query(`
      INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status)
      VALUES ($1, 'accepted', 'active', 'accepted')
    `, [questId]);

    return {
      success: true,
      quest_id: questId,
      deadline: deadline.toISOString(),
      points_reward: quest.points_reward,
    };
  } finally {
    client.release();
  }
}

/**
 * Decline a quest
 */
async function declineQuest(questId) {
  const client = await database.getClient();

  try {
    const questResult = await client.query(`
      SELECT * FROM smart_action_items WHERE id = $1
    `, [questId]);

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.action_type.startsWith('quest_')) {
      throw new Error('This action item is not a quest');
    }

    await client.query(`
      UPDATE smart_action_items
      SET user_status = 'dismissed',
          dismissed_at = datetime('now')
      WHERE id = $1
    `, [questId]);

    // Update user stats
    await client.query(`
      UPDATE user_quest_stats
      SET quests_declined = quests_declined + 1
      WHERE id = 1
    `);

    // Add to history
    await client.query(`
      INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status)
      VALUES ($1, 'dismissed', $2, 'dismissed')
    `, [questId, quest.user_status]);

    return { success: true, quest_id: questId };
  } finally {
    client.release();
  }
}

/**
 * Verify quest completion and award points
 */
async function verifyQuestCompletion(questId, manualResult = null) {
  const client = await database.getClient();

  try {
    const questResult = await client.query(`
      SELECT * FROM smart_action_items WHERE id = $1
    `, [questId]);

    if (questResult.rows.length === 0) {
      throw new Error('Quest not found');
    }

    const quest = questResult.rows[0];

    if (!quest.action_type.startsWith('quest_')) {
      throw new Error('This action item is not a quest');
    }

    if (quest.user_status !== 'accepted') {
      throw new Error(`Quest cannot be verified (current status: ${quest.user_status})`);
    }

    const criteria = quest.completion_criteria ? JSON.parse(quest.completion_criteria) : null;
    let actualValue = null;
    let success = false;
    let achievementPct = 0;

    // Auto-verify based on criteria type
    if (criteria) {
      switch (criteria.type) {
        case 'spending_limit': {
          // Get actual spending for the quest period
          const startDate = quest.accepted_at;
          const endDate = quest.deadline || new Date().toISOString();

          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2 AND date <= $3
              AND price < 0
          `, [criteria.category_definition_id, startDate.split('T')[0], endDate.split('T')[0]]);

          actualValue = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          success = actualValue <= criteria.target_amount;
          achievementPct = criteria.target_amount > 0 ? Math.round((1 - actualValue / criteria.target_amount) * 100 + 100) : 100;
          break;
        }

        case 'budget_adherence': {
          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2 AND date <= $3
              AND price < 0
          `, [criteria.category_definition_id, quest.accepted_at.split('T')[0], (quest.deadline || new Date().toISOString()).split('T')[0]]);

          actualValue = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          success = actualValue <= criteria.target_limit;
          achievementPct = criteria.target_limit > 0 ? Math.round((1 - actualValue / criteria.target_limit) * 100 + 100) : 100;
          break;
        }

        case 'budget_exists': {
          const budgetResult = await client.query(`
            SELECT id FROM category_budgets
            WHERE category_definition_id = $1 AND is_active = 1
          `, [criteria.category_definition_id]);

          actualValue = budgetResult.rows.length > 0 ? 1 : 0;
          success = budgetResult.rows.length > 0;
          achievementPct = success ? 100 : 0;
          break;
        }

        case 'fixed_cost_reduction': {
          // Compare recent spending to baseline
          const recentResult = await client.query(`
            SELECT AVG(ABS(price)) as avg_recent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2
              AND price < 0
          `, [criteria.category_definition_id, quest.accepted_at.split('T')[0]]);

          actualValue = parseFloat(recentResult.rows[0]?.avg_recent || criteria.baseline_amount);
          success = actualValue < criteria.baseline_amount;
          achievementPct = success ? Math.round((1 - actualValue / criteria.baseline_amount) * 100 + 100) : 0;
          break;
        }

        case 'savings_transfer': {
          // Manual verification required for savings
          if (manualResult !== null) {
            actualValue = manualResult.amount || 0;
            success = actualValue >= criteria.target_amount;
            achievementPct = criteria.target_amount > 0 ? Math.round((actualValue / criteria.target_amount) * 100) : 100;
          }
          break;
        }
      }
    }

    // If manual result provided, use it
    if (manualResult !== null && typeof manualResult === 'object') {
      if ('success' in manualResult) success = manualResult.success;
      if ('actualValue' in manualResult) actualValue = manualResult.actualValue;
      if ('achievementPct' in manualResult) achievementPct = manualResult.achievementPct;
    }

    // Calculate points earned (partial credit)
    let pointsEarned = 0;
    if (success) {
      if (achievementPct >= 120) {
        pointsEarned = Math.round(quest.points_reward * 1.25); // Bonus
      } else {
        pointsEarned = quest.points_reward;
      }
    } else if (achievementPct >= 80) {
      pointsEarned = Math.round(quest.points_reward * 0.5); // Partial credit
    }

    const newStatus = success || achievementPct >= 80 ? 'resolved' : 'failed';
    const completionResult = JSON.stringify({
      success,
      actual_value: actualValue,
      achievement_pct: achievementPct,
      points_earned: pointsEarned,
      verified_at: new Date().toISOString(),
    });

    // Update quest
    await client.query(`
      UPDATE smart_action_items
      SET user_status = $2,
          resolved_at = datetime('now'),
          points_earned = $3,
          completion_result = $4
      WHERE id = $1
    `, [questId, newStatus, pointsEarned, completionResult]);

    // Update user stats
    if (pointsEarned > 0) {
      await client.query(`
        UPDATE user_quest_stats
        SET total_points = total_points + $1,
            quests_completed = quests_completed + 1,
            current_streak = current_streak + 1,
            best_streak = MAX(best_streak, current_streak + 1),
            last_completed_at = datetime('now'),
            level = $2
        WHERE id = 1
      `, [pointsEarned, 'PLACEHOLDER']); // Level calculated below

      // Recalculate level
      const statsResult = await client.query(`SELECT total_points FROM user_quest_stats WHERE id = 1`);
      const totalPoints = parseInt(statsResult.rows[0]?.total_points || 0, 10);
      const newLevel = calculateLevel(totalPoints);

      await client.query(`UPDATE user_quest_stats SET level = $1 WHERE id = 1`, [newLevel]);
    } else {
      await client.query(`
        UPDATE user_quest_stats
        SET quests_failed = quests_failed + 1,
            current_streak = 0
        WHERE id = 1
      `);
    }

    // Add to history
    await client.query(`
      INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status, metadata)
      VALUES ($1, $2, 'accepted', $3, $4)
    `, [questId, newStatus === 'resolved' ? 'resolved' : 'failed', newStatus, completionResult]);

    return {
      success,
      quest_id: questId,
      points_earned: pointsEarned,
      achievement_pct: achievementPct,
      actual_value: actualValue,
      new_status: newStatus,
    };
  } finally {
    client.release();
  }
}

/**
 * Get active quests with progress calculation
 */
async function getActiveQuests(params = {}) {
  const { locale: localeInput } = params;
  const locale = resolveLocale(localeInput);
  const client = await database.getClient();

  try {
    const result = await client.query(`
      SELECT
        sai.*,
        cd.name as category_name,
        cd.name_en as category_name_en
      FROM smart_action_items sai
      LEFT JOIN category_definitions cd ON sai.trigger_category_id = cd.id
      WHERE sai.action_type LIKE 'quest_%'
        AND sai.user_status IN ('active', 'accepted')
      ORDER BY
        CASE sai.user_status WHEN 'accepted' THEN 1 ELSE 2 END,
        sai.deadline ASC NULLS LAST,
        sai.detected_at DESC
    `);

    const quests = [];
    const now = new Date();

    for (const row of result.rows) {
      const localizedName = row.category_name ? getLocalizedCategoryName({
        name: row.category_name,
        name_en: row.category_name_en,
        name_fr: null,
      }, locale) : null;

      // Calculate progress for accepted quests
      let progress = null;
      if (row.user_status === 'accepted' && row.completion_criteria) {
        const criteria = JSON.parse(row.completion_criteria);

        if (criteria.type === 'spending_limit' || criteria.type === 'budget_adherence') {
          const startDate = row.accepted_at;
          const spendingResult = await client.query(`
            SELECT COALESCE(SUM(ABS(price)), 0) as total_spent
            FROM transactions
            WHERE category_definition_id = $1
              AND date >= $2
              AND price < 0
          `, [criteria.category_definition_id, startDate.split('T')[0]]);

          const spent = parseFloat(spendingResult.rows[0]?.total_spent || 0);
          const target = criteria.target_amount || criteria.target_limit || 0;
          progress = {
            current: spent,
            target,
            percentage: target > 0 ? Math.round((spent / target) * 100) : 0,
            on_track: spent <= target,
          };
        }
      }

      // Calculate time remaining
      let timeRemaining = null;
      if (row.deadline) {
        const deadline = new Date(row.deadline);
        const diffMs = deadline - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        timeRemaining = {
          days: Math.max(0, diffDays),
          expired: diffDays < 0,
        };
      }

      quests.push({
        ...row,
        category_name: localizedName || row.category_name,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        completion_criteria: row.completion_criteria ? JSON.parse(row.completion_criteria) : null,
        progress,
        time_remaining: timeRemaining,
      });
    }

    return { quests, count: quests.length };
  } finally {
    client.release();
  }
}

/**
 * Get user quest stats with streak reset check
 */
async function getUserQuestStats() {
  const client = await database.getClient();

  try {
    // Ensure stats row exists
    await client.query(`
      INSERT OR IGNORE INTO user_quest_stats (id, total_points, current_streak, best_streak, quests_completed, quests_failed, quests_declined, level)
      VALUES (1, 0, 0, 0, 0, 0, 0, 1)
    `);

    const result = await client.query(`SELECT * FROM user_quest_stats WHERE id = 1`);
    const stats = result.rows[0];

    // Check streak reset (30 days inactivity)
    if (stats.last_completed_at) {
      const lastCompleted = new Date(stats.last_completed_at);
      const now = new Date();
      const daysSinceCompletion = Math.floor((now - lastCompleted) / (1000 * 60 * 60 * 24));

      if (daysSinceCompletion > STREAK_RESET_DAYS && stats.current_streak > 0) {
        await client.query(`UPDATE user_quest_stats SET current_streak = 0 WHERE id = 1`);
        stats.current_streak = 0;
        stats.streak_reset = true;
      }
    }

    // Calculate next level info
    const currentLevel = stats.level;
    const nextLevelTier = LEVEL_TIERS.find(t => t.level === currentLevel + 1);
    const currentLevelTier = LEVEL_TIERS.find(t => t.level === currentLevel);

    return {
      ...stats,
      level_progress: nextLevelTier ? {
        current_level: currentLevel,
        next_level: currentLevel + 1,
        points_for_next: nextLevelTier.points,
        points_needed: nextLevelTier.points - stats.total_points,
        progress_pct: Math.round(((stats.total_points - (currentLevelTier?.points || 0)) / (nextLevelTier.points - (currentLevelTier?.points || 0))) * 100),
      } : {
        current_level: currentLevel,
        max_level_reached: true,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Check quest deadlines and auto-verify expired quests
 */
async function checkQuestDeadlines() {
  const client = await database.getClient();
  const results = { verified: 0, failed: 0, errors: [] };

  try {
    // Find accepted quests past deadline
    const expiredResult = await client.query(`
      SELECT id FROM smart_action_items
      WHERE action_type LIKE 'quest_%'
        AND user_status = 'accepted'
        AND deadline < datetime('now')
    `);

    for (const row of expiredResult.rows) {
      try {
        const result = await verifyQuestCompletion(row.id);
        if (result.success || result.points_earned > 0) {
          results.verified++;
        } else {
          results.failed++;
        }
      } catch (err) {
        results.errors.push({ quest_id: row.id, error: err.message });
      }
    }

    // Trigger on-demand quest generation if below threshold
    const activeCount = await getActiveQuestCount(client);
    let generated = 0;
    if (activeCount < MIN_QUESTS_BEFORE_GENERATION) {
      const genResult = await generateQuests({});
      generated = genResult.created || 0;
    }

    return {
      ...results,
      checked: expiredResult.rows.length,
      active_quests: activeCount,
      new_quests_generated: generated,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  generateQuests,
  acceptQuest,
  declineQuest,
  verifyQuestCompletion,
  getActiveQuests,
  getUserQuestStats,
  checkQuestDeadlines,
  // Constants for external use
  QUEST_ACTION_TYPES,
  LEVEL_TIERS,
  MAX_ACTIVE_QUESTS,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
