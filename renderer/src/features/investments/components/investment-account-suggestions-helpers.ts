interface SuggestionLike {
  suggestedAccountType: string;
  suggestedInstitution: string | null;
  suggestedAccountName: string;
  transactions?: Array<{ transactionIdentifier: string }>;
}

interface AccountLike {
  account_type: string;
  institution?: {
    display_name_he?: string;
    display_name_en?: string;
  } | null;
}

export const getInvestmentSuggestionKey = (suggestion: SuggestionLike): string => {
  if (suggestion.transactions?.length) {
    return suggestion.transactions
      .map((txn) => txn.transactionIdentifier)
      .sort()
      .join('|');
  }
  return `${suggestion.suggestedAccountType}-${suggestion.suggestedAccountName}-${suggestion.suggestedInstitution ?? 'none'}`;
};

export const findMatchingInvestmentAccounts = <T extends AccountLike>(
  suggestion: SuggestionLike,
  investmentAccounts: T[],
): T[] =>
  investmentAccounts.filter((account) => {
    if (account.account_type === suggestion.suggestedAccountType) {
      return true;
    }
    if (suggestion.suggestedInstitution && account.institution) {
      const institutionName =
        account.institution.display_name_he || account.institution.display_name_en || '';

      if (institutionName) {
        const normalizedInstitution = institutionName.toLowerCase();
        const normalizedSuggestionInstitution = suggestion.suggestedInstitution.toLowerCase();
        return (
          normalizedInstitution.includes(normalizedSuggestionInstitution) ||
          normalizedSuggestionInstitution.includes(normalizedInstitution)
        );
      }
    }
    return false;
  });
