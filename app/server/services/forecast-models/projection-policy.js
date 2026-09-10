function descriptorFor(row) {
  return { categoryType: row.category_type, category: row.category_name,
    categoryNameEn: row.category_name_en, parentCategory: row.parent_category_name,
    transactionName: row.name, isCountedAsIncome: row.is_counted_as_income };
}

function prepareProjectionPolicy(transactions, truthSnapshot, engine, categoryDefinitions = []) {
  const categories = new Map(categoryDefinitions.map(c => [Number(c.id), { category: c.name, categoryType: c.category_type,
    categoryNameEn: c.name_en, isCountedAsIncome: c.is_counted_as_income,
    parentCategory: categoryDefinitions.find(parent => parent.id === c.parent_id)?.name }]));
  transactions.filter(t => t.category_definition_id != null)
    .forEach(t => categories.set(Number(t.category_definition_id), descriptorFor(t)));
  const patterns = (truthSnapshot.patterns || []).flatMap(pattern => {
    const category = categories.get(Number(pattern.categoryDefinitionId));
    const descriptor = { ...category,
      categoryType: pattern.direction, transactionName: pattern.displayName };
    const incomeType = pattern.direction === 'income'
      ? (engine.isNonOperatingIncomePattern(descriptor) ? 'non_operating' : 'operating') : null;
    const expenseType = pattern.direction === 'expense'
      ? (engine.isNonOperatingExpensePattern(descriptor) ? 'non_operating' : 'operating') : null;
    const isExplicit = pattern.source !== 'detected' || pattern.confirmed
      || pattern.corrections?.some(c => c.action === 'override_pattern');
    // A positive expense refund or an investment transfer is not a recurring income/expense stream.
    if (!isExplicit && category?.categoryType && category.categoryType !== pattern.direction) return [];
    // Irregular receipts are not evidence of dependable future income.
    if (incomeType === 'non_operating' && !isExplicit) return [];
    return [{ ...pattern, incomeType, expenseType }];
  });
  return {
    truthSnapshot: { ...truthSnapshot, patterns },
    transactions: transactions.filter(t => t.category_type !== 'income'
      || (Number(t.price) > 0 && !engine.isNonOperatingIncomePattern(descriptorFor(t)))),
  };
}
module.exports = { descriptorFor, prepareProjectionPolicy };
