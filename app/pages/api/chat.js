import { getDB } from './db.js';

/**
 * Financial Chatbot API with Placeholder LLM Logic
 *
 * Future integration: Will send transaction data + user message to LLM (OpenAI, Claude, etc.)
 * Current: Smart placeholder responses based on keywords and transaction analysis
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Fetch user's financial data for context
    const financialContext = await getFinancialContext(client);

    // Generate smart placeholder response
    const response = await generatePlaceholderResponse(message, financialContext);

    res.status(200).json({
      response,
      timestamp: new Date().toISOString(),
      // Future: will include LLM metadata like model, tokens, etc.
      metadata: {
        model: 'placeholder-v1',
        contextIncluded: {
          transactions: financialContext.transactionCount,
          categories: financialContext.categoryCount,
          timeRange: '3 months',
        },
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({
      error: 'Failed to process chat message',
      details: error.message,
    });
  } finally {
    client.release();
  }
}

/**
 * Fetch user's financial context for the chatbot
 */
async function getFinancialContext(client) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // Get summary statistics
  const summaryResult = await client.query(`
    SELECT
      COUNT(*) as transaction_count,
      SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
      SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses
    FROM transactions
    WHERE date >= $1
  `, [threeMonthsAgo]);

  // Get category breakdown
  const categoriesResult = await client.query(`
    SELECT
      COALESCE(parent_category, category) as category,
      SUM(ABS(price)) as total,
      COUNT(*) as count
    FROM transactions
    WHERE date >= $1 AND price < 0
    GROUP BY COALESCE(parent_category, category)
    ORDER BY total DESC
    LIMIT 10
  `, [threeMonthsAgo]);

  // Get recent transactions
  const recentResult = await client.query(`
    SELECT name, price, date, parent_category
    FROM transactions
    ORDER BY date DESC
    LIMIT 20
  `);

  // Get top merchants
  const merchantsResult = await client.query(`
    SELECT
      merchant_name,
      COUNT(*) as visit_count,
      SUM(ABS(price)) as total_spent
    FROM transactions
    WHERE date >= $1 AND price < 0 AND merchant_name IS NOT NULL
    GROUP BY merchant_name
    ORDER BY total_spent DESC
    LIMIT 10
  `, [threeMonthsAgo]);

  const summary = summaryResult.rows[0];

  return {
    transactionCount: parseInt(summary.transaction_count || 0),
    totalIncome: parseFloat(summary.total_income || 0),
    totalExpenses: parseFloat(summary.total_expenses || 0),
    categoryCount: categoriesResult.rows.length,
    categories: categoriesResult.rows.map((c) => ({
      name: c.category,
      total: parseFloat(c.total),
      count: parseInt(c.count),
    })),
    recentTransactions: recentResult.rows.map((t) => ({
      name: t.name,
      price: parseFloat(t.price),
      date: t.date,
      category: t.parent_category,
    })),
    topMerchants: merchantsResult.rows.map((m) => ({
      name: m.merchant_name,
      visits: parseInt(m.visit_count),
      total: parseFloat(m.total_spent),
    })),
  };
}

/**
 * Generate smart placeholder response based on keywords
 * Future: Replace with actual LLM API call (OpenAI, Claude, etc.)
 */
async function generatePlaceholderResponse(message, context) {
  const lowerMessage = message.toLowerCase();

  // Hebrew keyword matching
  const hebrewPatterns = {
    monthlySpending: /כמה הוצאתי|סה"כ הוצאות|הוצאות החודש/,
    topCategory: /קטגוריה|הכי הרבה|הוצאה הגדולה/,
    savings: /חיסכון|לחסוך|המלצות/,
    anomalies: /חריגה|חריגות|יוצא דופן/,
    income: /הכנסה|משכורת|רווח/,
    comparison: /השוואה|בהשוואה|לעומת/,
    merchants: /חנויות|עסקים|איפה הוצאתי/,
    trends: /מגמה|מגמות|דפוס/,
  };

  // Monthly spending question
  if (hebrewPatterns.monthlySpending.test(lowerMessage)) {
    const monthlyExpenses = Math.round(context.totalExpenses / 3);
    const savingsRate =
      context.totalIncome > 0
        ? Math.round(((context.totalIncome - context.totalExpenses) / context.totalIncome) * 100)
        : 0;

    return `📊 **סיכום ההוצאות שלך:**

בממוצע, אתה מוציא **₪${monthlyExpenses.toLocaleString()}** לחודש ב-3 החודשים האחרונים.

**פילוח לפי קטגוריות:**
${context.categories
  .slice(0, 5)
  .map((c, i) => `${i + 1}. ${c.name}: ₪${Math.round(c.total).toLocaleString()} (${c.count} עסקאות)`)
  .join('\n')}

${
  savingsRate > 0
    ? `✅ שיעור החיסכון שלך: **${savingsRate}%** - ${savingsRate > 20 ? 'מצוין!' : 'יש מקום לשיפור'}`
    : '⚠️ כרגע אתה לא חוסך. בוא ננסה למצוא דרכים לחסוך יותר!'
}`;
  }

  // Top category question
  if (hebrewPatterns.topCategory.test(lowerMessage)) {
    if (context.categories.length === 0) {
      return 'לא מצאתי מספיק נתונים כדי לנתח את ההוצאות שלך.';
    }

    const topCategory = context.categories[0];
    const percentage = Math.round((topCategory.total / context.totalExpenses) * 100);

    return `🏆 **הקטגוריה עם ההוצאה הגבוהה ביותר:**

**${topCategory.name}** - ₪${Math.round(topCategory.total).toLocaleString()} (${percentage}% מכלל ההוצאות)

זה כולל ${topCategory.count} עסקאות.

${
  percentage > 40
    ? '💡 זה חלק גבוה מההוצאות שלך. שקול לבדוק אם יש מקום לייעול.'
    : '✅ נראה סביר ומאוזן.'
}`;
  }

  // Savings recommendations
  if (hebrewPatterns.savings.test(lowerMessage)) {
    const recommendations = [];

    // Find expensive categories
    const expensiveCategory = context.categories.find((c) => c.total / context.totalExpenses > 0.3);
    if (expensiveCategory) {
      recommendations.push(
        `📉 **${expensiveCategory.name}**: מהווה ${Math.round((expensiveCategory.total / context.totalExpenses) * 100)}% מההוצאות. נסה להפחית ב-10% - חיסכון של ₪${Math.round(expensiveCategory.total * 0.1)}/חודש`
      );
    }

    // Check for frequent merchants
    if (context.topMerchants.length > 0) {
      const topMerchant = context.topMerchants[0];
      if (topMerchant.visits > 5) {
        recommendations.push(
          `☕ **${topMerchant.name}**: ${topMerchant.visits} ביקורים, ₪${Math.round(topMerchant.total)}. שקול להפחית ב-20% - חיסכון של ₪${Math.round(topMerchant.total * 0.2)}`
        );
      }
    }

    // General recommendations
    recommendations.push(
      `💰 **יעד חיסכון מומלץ**: 15-20% מההכנסה (₪${Math.round(context.totalIncome * 0.15)} - ₪${Math.round(context.totalIncome * 0.2)} לחודש)`
    );
    recommendations.push(`🎯 **כלל 50/30/20**: 50% צרכים, 30% רצונות, 20% חיסכון`);

    return `💡 **המלצות לחיסכון:**\n\n${recommendations.join('\n\n')}`;
  }

  // Anomalies question
  if (hebrewPatterns.anomalies.test(lowerMessage)) {
    const unusualTransactions = context.recentTransactions
      .filter((t) => Math.abs(t.price) > 500)
      .slice(0, 5);

    if (unusualTransactions.length === 0) {
      return '✅ לא זיהיתי הוצאות חריגות לאחרונה. כל הנתונים נראים תקינים!';
    }

    return `⚠️ **הוצאות חריגות שזוהו:**\n\n${unusualTransactions
      .map((t) => {
        const date = new Date(t.date).toLocaleDateString('he-IL');
        return `• **${t.name}**: ₪${Math.abs(t.price).toLocaleString()} (${date})`;
      })
      .join('\n')}\n\nאם אלו הוצאות חד-פעמיות מתוכננות, הכל בסדר. אחרת, שקול לבדוק אותן.`;
  }

  // Merchants question
  if (hebrewPatterns.merchants.test(lowerMessage)) {
    if (context.topMerchants.length === 0) {
      return 'לא מצאתי מספיק נתוני עסקים מסווגים.';
    }

    return `🏪 **העסקים שאתה מבקר הכי הרבה:**\n\n${context.topMerchants
      .slice(0, 5)
      .map((m, i) => `${i + 1}. **${m.name}**: ${m.visits} ביקורים, סה"כ ₪${Math.round(m.total).toLocaleString()}`)
      .join('\n')}`;
  }

  // Default response with context
  const avgDaily = Math.round(context.totalExpenses / 90);
  const savingsRate =
    context.totalIncome > 0
      ? Math.round(((context.totalIncome - context.totalExpenses) / context.totalIncome) * 100)
      : 0;

  return `👋 אני כאן כדי לעזור לך להבין את הפיננסים שלך!

📊 **סיכום מהיר:**
• סה"כ עסקאות: ${context.transactionCount}
• הוצאה יומית ממוצעת: ₪${avgDaily}
• שיעור חיסכון: ${savingsRate}%

💬 **אפשר לשאול אותי:**
• "כמה הוצאתי החודש?"
• "מה הקטגוריה שהוצאתי בה הכי הרבה?"
• "תן לי המלצות לחיסכון"
• "האם יש הוצאות חריגות?"

🤖 *בעתיד אני אשתמש ב-AI מתקדם כדי לתת תשובות מותאמות אישית עוד יותר!*`;
}
