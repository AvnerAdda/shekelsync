const database = require('./database.js');

function serviceError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  return error;
}

async function getFinancialContext(client) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const summaryResult = await client.query(
    `
      SELECT
        COUNT(*) as transaction_count,
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses
      FROM transactions
      WHERE date >= $1
    `,
    [threeMonthsAgo],
  );

  const categoriesResult = await client.query(
    `
      SELECT
        COALESCE(parent.name, cd.name) as category,
        SUM(ABS(price)) as total,
        COUNT(*) as count
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE t.date >= $1 AND t.price < 0
      GROUP BY COALESCE(parent.name, cd.name)
      ORDER BY total DESC
      LIMIT 10
    `,
    [threeMonthsAgo],
  );

  const recentResult = await client.query(`
    SELECT
      t.name,
      t.price,
      t.date,
      COALESCE(parent.name, cd.name) as parent_category
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    ORDER BY t.date DESC
    LIMIT 20
  `);

  const merchantsResult = await client.query(
    `
      SELECT
        merchant_name,
        COUNT(*) as visit_count,
        SUM(ABS(price)) as total_spent
      FROM transactions
      WHERE date >= $1 AND price < 0 AND merchant_name IS NOT NULL
      GROUP BY merchant_name
      ORDER BY total_spent DESC
      LIMIT 10
    `,
    [threeMonthsAgo],
  );

  const summary = summaryResult.rows[0] || {};

  return {
    transactionCount: Number.parseInt(summary.transaction_count || 0, 10),
    totalIncome: Number.parseFloat(summary.total_income || 0),
    totalExpenses: Number.parseFloat(summary.total_expenses || 0),
    categoryCount: categoriesResult.rows.length,
    categories: categoriesResult.rows.map((c) => ({
      name: c.category,
      total: Number.parseFloat(c.total),
      count: Number.parseInt(c.count, 10),
    })),
    recentTransactions: recentResult.rows.map((t) => ({
      name: t.name,
      price: Number.parseFloat(t.price),
      date: t.date,
      category: t.parent_category,
    })),
    topMerchants: merchantsResult.rows.map((m) => ({
      name: m.merchant_name,
      visits: Number.parseInt(m.visit_count, 10),
      total: Number.parseFloat(m.total_spent),
    })),
  };
}

async function generatePlaceholderResponse(message, context) {
  const lowerMessage = message.toLowerCase();

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

  if (hebrewPatterns.monthlySpending.test(lowerMessage)) {
    const monthlyExpenses = Math.round((context.totalExpenses || 0) / 3);
    const savingsRate =
      context.totalIncome > 0
        ? Math.round(
            ((context.totalIncome - context.totalExpenses) / context.totalIncome) * 100,
          )
        : 0;

    const categoriesList = context.categories
      .slice(0, 5)
      .map(
        (c, i) =>
          `${i + 1}. ${c.name}: ₪${Math.round(c.total).toLocaleString()} (${c.count} עסקאות)`,
      )
      .join('\\n');

    const savingsMessage =
      savingsRate > 0
        ? `✅ שיעור החיסכון שלך: **${savingsRate}%** - ${savingsRate > 20 ? 'מצוין!' : 'יש מקום לשיפור'}`
        : '⚠️ כרגע אתה לא חוסך. בוא ננסה למצוא דרכים לחסוך יותר!';

    return `📊 **סיכום ההוצאות שלך:**\\n\\nבממוצע, אתה מוציא **₪${monthlyExpenses.toLocaleString()}** לחודש ב-3 החודשים האחרונים.\\n\\n**פילוח לפי קטגוריות:**\\n${categoriesList}\\n\\n${savingsMessage}`;
  }

  if (hebrewPatterns.topCategory.test(lowerMessage)) {
    if (context.categories.length === 0) {
      return 'לא מצאתי מספיק נתונים כדי לנתח את ההוצאות שלך.';
    }

    const topCategory = context.categories[0];
    const percentage =
      context.totalExpenses > 0 ? Math.round((topCategory.total / context.totalExpenses) * 100) : 0;

    const advisory =
      percentage > 40
        ? '💡 זה חלק גבוה מההוצאות שלך. שקול לבדוק אם יש מקום לייעול.'
        : '✅ נראה סביר ומאוזן.';

    return `🏆 **הקטגוריה עם ההוצאה הגבוהה ביותר:**\\n\\n**${topCategory.name}** - ₪${Math.round(topCategory.total).toLocaleString()} (${percentage}% מכלל ההוצאות)\\n\\nזה כולל ${topCategory.count} עסקאות.\\n\\n${advisory}`;
  }

  if (hebrewPatterns.savings.test(lowerMessage)) {
    const highestCategory = context.categories[0];
    const monthlyExpenses = Math.round((context.totalExpenses || 0) / 3);

    const merchantsAdvice =
      context.topMerchants.length > 0
        ? `🛍️ **ספקים שכדאי לבדוק:**\\n${context.topMerchants
            .slice(0, 5)
            .map(
              (m, i) =>
                `${i + 1}. ${m.name}: ₪${Math.round(m.total).toLocaleString()} (${m.visits} ביקורים)`,
            )
            .join('\\n')}`
        : '';

    const expensesAdvice =
      highestCategory && highestCategory.total > 0
        ? `💡 שקול להפחית הוצאות בקטגוריית **${highestCategory.name}**. גם חיסכון של 5% יהפוך ל-₪${Math.round(
            monthlyExpenses * 0.05,
          ).toLocaleString()} פנויים לחודש.`
        : '';

    return `💰 **רעיונות לחיסכון חכם:**\\n\\n${expensesAdvice}\\n\\n${merchantsAdvice}\\n\\n🎯 הצבת יעד: נסה להפחית ₪${Math.round(
      monthlyExpenses * 0.1,
    ).toLocaleString()} בהוצאות החודשיות – זה מצטבר ל-₪${Math.round(monthlyExpenses * 1.2).toLocaleString()} בשנה!`;
  }

  if (hebrewPatterns.anomalies.test(lowerMessage)) {
    const unusualExpenses = context.recentTransactions
      .filter((t) => Math.abs(t.price) > 1000)
      .slice(0, 3);

    if (unusualExpenses.length === 0) {
      return 'לא מצאתי הוצאות חריגות בחודשים האחרונים. הכל נראה רגיל!';
    }

    const expensesList = unusualExpenses
      .map(
        (t) =>
          `- ${t.name} (${t.category || 'ללא קטגוריה'}) – ₪${Math.round(Math.abs(t.price)).toLocaleString()} בתאריך ${new Date(t.date).toLocaleDateString('he-IL')}`,
      )
      .join('\\n');

    return `🚨 **הוצאות חריגות שמצאתי:**\\n\\n${expensesList}\\n\\n💡 כדאי לבדוק אם אלו הוצאות חד פעמיות או שניתן לצמצם אותן בעתיד.`;
  }

  if (hebrewPatterns.income.test(lowerMessage)) {
    const months = context.totalIncome > 0 ? Math.round((context.totalExpenses / context.totalIncome) * 3) : 0;

    const savingsRate =
      context.totalIncome > 0
        ? Math.round(((context.totalIncome - context.totalExpenses) / context.totalIncome) * 100)
        : 0;

    const trend =
      savingsRate > 0
        ? `✅ אתה חוסך בממוצע ${savingsRate}% מההכנסה שלך. מצוין!`
        : '⚠️ כרגע ההוצאות שוות או עולות על ההכנסות. כדאי לבדוק איפה אפשר לצמצם.';

    return `💼 **הכנסות מול הוצאות:**\\n\\n- הכנסות ב-3 חודשים: ₪${Math.round(
      context.totalIncome,
    ).toLocaleString()}\\n- הוצאות ב-3 חודשים: ₪${Math.round(
      context.totalExpenses,
    ).toLocaleString()}\\n- יחס הוצאה/הכנסה: ${months > 0 ? `${months * 33}%` : 'לא זמין'}\\n\\n${trend}`;
  }

  if (hebrewPatterns.comparison.test(lowerMessage)) {
    const firstFive = context.categories.slice(0, 5);
    if (firstFive.length === 0) {
      return 'אין מספיק נתונים להשוואה כרגע. נסה לשאול שוב אחרי שנסרוק עוד עסקאות!';
    }

    const comparison = firstFive
      .map(
        (c, i) =>
          `${i + 1}. ${c.name}: ₪${Math.round(c.total).toLocaleString()} (${Math.round((c.total / context.totalExpenses) * 100)}% מההוצאות)`,
      )
      .join('\\n');

    return `⚖️ **השוואת הוצאות בין קטגוריות:**\\n\\n${comparison}\\n\\n💡 עצה: אם שתי קטגוריות גדולות נמצאות על אותה רמת הוצאה, שקול לבחור אחת לצמצום השבוע.`;
  }

  if (hebrewPatterns.merchants.test(lowerMessage)) {
    if (context.topMerchants.length === 0) {
      return 'לא מצאתי עסקאות משמעותיות אצל ספקים חוזרים.';
    }

    const merchantsList = context.topMerchants
      .slice(0, 5)
      .map(
        (m, i) =>
          `${i + 1}. ${m.name}: ₪${Math.round(m.total).toLocaleString()} (${m.visits} ביקורים)`,
      )
      .join('\\n');

    return `🛍️ **הספקים שבהם הוצאת הכי הרבה:**\\n\\n${merchantsList}\\n\\n💡 טיפ: בדוק אם אפשר לעבור למוצרים מקוונים/זולים יותר עבור הספקים המובילים.`;
  }

  if (hebrewPatterns.trends.test(lowerMessage)) {
    const months = context.categories
      .slice(0, 3)
      .map((c) => `${c.name}: ₪${Math.round(c.total).toLocaleString()} (ממוצע בחודש)`)
      .join('\\n');

    return `📈 **המגמות הכספיות שלך:**\\n\\n${months}\\n\\n🎯 המלצה: בחר קטגוריה אחת שאתה רוצה לשפר החודש, ונעקוב אחר ההתקדמות שלך בשבוע הבא.`;
  }

  const monthlyExpenses = Math.round((context.totalExpenses || 0) / 3);
  const categoriesSummary = context.categories
    .slice(0, 3)
    .map((c) => `- ${c.name}: ₪${Math.round(c.total).toLocaleString()}`)
    .join('\\n');

  return `🤖 היי! הנה מה שאני יודע עליך מהחודשים האחרונים:\\n\\n- הוצאות חודשיות ממוצעות: ₪${monthlyExpenses.toLocaleString()}\\n- קטגוריות מובילות:\\n${categoriesSummary}\\n\\nאפשר לשאול אותי על חיסכון, קטגוריות הוצאה, מגמות, החריגות ועוד.`;
}

async function processMessage(payload = {}) {
  const { message, conversationHistory = [] } = payload;

  if (!message || typeof message !== 'string') {
    throw serviceError(400, 'Message is required');
  }

  const client = await database.getClient();

  try {
    const financialContext = await getFinancialContext(client);
    const response = await generatePlaceholderResponse(message, financialContext, conversationHistory);

    return {
      response,
      timestamp: new Date().toISOString(),
      metadata: {
        model: 'placeholder-v1',
        contextIncluded: {
          transactions: financialContext.transactionCount,
          categories: financialContext.categoryCount,
          timeRange: '3 months',
        },
      },
    };
  } catch (error) {
    const wrapped = error.status ? error : serviceError(500, 'Failed to process chat message', error.message);
    throw wrapped;
  } finally {
    client.release();
  }
}

module.exports = {
  processMessage,
};
module.exports.default = module.exports;
