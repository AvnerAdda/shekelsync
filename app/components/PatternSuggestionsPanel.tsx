import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  IconButton,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Stack,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Check as CheckIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useFinancePrivacy } from '../contexts/FinancePrivacyContext';

// Pattern from /api/patterns (snake_case from DB)
interface Pattern {
  id: number;
  pattern_name: string;
  pattern_regex: string;
  description?: string;
  match_type: string;
  override_category?: string;
  confidence: number;
  is_user_defined: boolean;
  is_auto_learned: boolean;
  match_count: number;
  is_active?: boolean;
}

// Pattern from /api/patterns/detect (camelCase in response)
interface SuggestionPattern {
  id: number;
  name: string;
  regex: string;
  description?: string;
  type: string;
  overrideCategory?: string;
  confidence: number;
}

interface PatternMatch {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  category: string;
  account_number?: string;
}

interface PatternSuggestion {
  pattern: SuggestionPattern;
  matches: PatternMatch[];
  matchCount: number;
}

interface PatternSuggestionsPanelProps {
  onDuplicatesChanged: () => void;
}

const MATCH_TYPES = [
  { value: 'credit_card_payment', label: 'Credit Card Payment' },
  { value: 'investment', label: 'Investment' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'rent', label: 'Rent' },
  { value: 'loan', label: 'Loan' },
  { value: 'savings', label: 'Savings' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_OVERRIDES = ['Investment', 'Transfer', 'Rent', 'Loan', 'Savings', 'Insurance', 'Other'];

const PatternSuggestionsPanel: React.FC<PatternSuggestionsPanelProps> = ({ onDuplicatesChanged }) => {
  const [suggestions, setSuggestions] = useState<PatternSuggestion[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [addPatternOpen, setAddPatternOpen] = useState(false);
  const [newPattern, setNewPattern] = useState({
    patternName: '',
    patternRegex: '',
    description: '',
    matchType: 'duplicate',
    overrideCategory: '',
  });

  useEffect(() => {
    fetchSuggestions();
    fetchPatterns();
  }, []);

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/patterns/detect');
      const data = await response.json();
      setSuggestions(data.suggestions || []);
    } catch (error) {
      console.error('Error fetching pattern suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPatterns = async () => {
    try {
      const response = await fetch('/api/patterns');
      const data = await response.json();
      setPatterns(data.patterns || []);
    } catch (error) {
      console.error('Error fetching patterns:', error);
    }
  };

  const handleAddPattern = async () => {
    try {
      const response = await fetch('/api/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPattern),
      });

      if (response.ok) {
        setAddPatternOpen(false);
        setNewPattern({
          patternName: '',
          patternRegex: '',
          description: '',
          matchType: 'duplicate',
          overrideCategory: '',
        });
        await fetchPatterns();
        await fetchSuggestions();
      } else {
        const error = await response.json();
        alert(`Failed to add pattern: ${error.error}`);
      }
    } catch (error) {
      console.error('Error adding pattern:', error);
      alert('Error adding pattern');
    }
  };

  const handleDeletePattern = async (patternId: number) => {
    if (!confirm('Delete this pattern? This cannot be undone.')) return;

    try {
      const response = await fetch(`/api/patterns?id=${patternId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchPatterns();
        await fetchSuggestions();
      } else {
        alert('Failed to delete pattern');
      }
    } catch (error) {
      console.error('Error deleting pattern:', error);
    }
  };

  const handleTogglePattern = async (pattern: Pattern) => {
    try {
      const response = await fetch('/api/patterns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pattern.id,
          isActive: !pattern.is_active,
        }),
      });

      if (response.ok) {
        await fetchPatterns();
        await fetchSuggestions();
      }
    } catch (error) {
      console.error('Error toggling pattern:', error);
    }
  };

  const getTxnKey = (match: PatternMatch) => `${match.identifier}-${match.vendor}`;

  const handleSelectMatch = (match: PatternMatch) => {
    const key = getTxnKey(match);
    const newSelected = new Set(selectedMatches);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedMatches(newSelected);
  };

  const handleConfirmSelected = async (pattern: SuggestionPattern) => {
    const matchesToConfirm = suggestions
      .find(s => s.pattern.id === pattern.id)
      ?.matches.filter(m => selectedMatches.has(getTxnKey(m))) || [];

    if (matchesToConfirm.length === 0) return;

    try {
      for (const match of matchesToConfirm) {
        await fetch('/api/duplicates/manual-exclude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionIdentifier: match.identifier,
            transactionVendor: match.vendor,
            reason: pattern.type,
            overrideCategory: pattern.overrideCategory,
            notes: `Matched pattern: ${pattern.name}`,
          }),
        });
      }

      setSelectedMatches(new Set());
      await fetchSuggestions();
      onDuplicatesChanged();
    } catch (error) {
      console.error('Error confirming matches:', error);
      alert('Error confirming matches');
    }
  };

  const { formatCurrency } = useFinancePrivacy();

  const formatCurrencyValue = (value: number) =>
    formatCurrency(value, { absolute: true, maximumFractionDigits: 0 });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getMatchTypeColor = (type: string) => {
    const colors: { [key: string]: any } = {
      credit_card_payment: 'primary',
      investment: 'info',
      transfer: 'secondary',
      rent: 'warning',
      loan: 'default',
      savings: 'success',
      duplicate: 'error',
    };
    return colors[type] || 'default';
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          Pattern-based duplicate detection uses regex patterns to find transactions that should be excluded.
          Patterns are learned from your manual exclusions and you can add custom patterns.
        </Typography>
      </Alert>

      {/* Pattern Management Section */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Detection Patterns ({patterns.length})</Typography>
          <Box>
            <Tooltip title="Add Custom Pattern">
              <IconButton size="small" color="primary" onClick={() => setAddPatternOpen(true)}>
                <AddIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={fetchSuggestions}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <TableContainer component={Paper} sx={{ maxHeight: 200, mb: 2 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Pattern</TableCell>
                <TableCell>Regex</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Matches</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {patterns.map((pattern) => (
                <TableRow key={pattern.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight="medium">
                      {pattern.pattern_name}
                    </Typography>
                    {pattern.description && (
                      <Typography variant="caption" color="text.secondary">
                        {pattern.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" fontFamily="monospace">
                      {pattern.pattern_regex}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={MATCH_TYPES.find(t => t.value === pattern.match_type)?.label || pattern.match_type}
                      color={getMatchTypeColor(pattern.match_type)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{pattern.match_count || 0}</TableCell>
                  <TableCell>
                    <Checkbox
                      checked={pattern.is_active !== false}
                      onChange={() => handleTogglePattern(pattern)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {pattern.is_user_defined && (
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => handleDeletePattern(pattern.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* Suggestions Section */}
      <Typography variant="h6" gutterBottom>
        Pattern Matches ({suggestions.reduce((sum, s) => sum + s.matchCount, 0)})
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : suggestions.length === 0 ? (
        <Alert severity="success">
          No pattern matches found! All transactions look clean.
        </Alert>
      ) : (
        <Box>
          {suggestions.map((suggestion) => (
            <Accordion key={suggestion.pattern.id}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                  <Typography variant="subtitle1" fontWeight="medium">
                    {suggestion.pattern.name}
                  </Typography>
                  <Chip
                    label={`${suggestion.matchCount} matches`}
                    color="warning"
                    size="small"
                  />
                  <Chip
                    label={MATCH_TYPES.find(t => t.value === suggestion.pattern.type)?.label}
                    color={getMatchTypeColor(suggestion.pattern.type)}
                    size="small"
                  />
                  {suggestion.pattern.overrideCategory && (
                    <Chip label={`→ ${suggestion.pattern.overrideCategory}`} size="small" variant="outlined" />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    Pattern: <code>{suggestion.pattern.regex}</code>
                  </Typography>

                  {selectedMatches.size > 0 && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2">
                          {selectedMatches.size} transaction(s) selected
                        </Typography>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleConfirmSelected(suggestion.pattern)}
                        >
                          Confirm Selected
                        </Button>
                      </Box>
                    </Alert>
                  )}

                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox">
                            <Checkbox
                              indeterminate={
                                selectedMatches.size > 0 &&
                                selectedMatches.size < suggestion.matches.length
                              }
                              checked={
                                suggestion.matches.length > 0 &&
                                suggestion.matches.every(m => selectedMatches.has(getTxnKey(m)))
                              }
                              onChange={() => {
                                const allSelected = suggestion.matches.every(m =>
                                  selectedMatches.has(getTxnKey(m))
                                );
                                const newSelected = new Set(selectedMatches);
                                suggestion.matches.forEach(m => {
                                  const key = getTxnKey(m);
                                  if (allSelected) {
                                    newSelected.delete(key);
                                  } else {
                                    newSelected.add(key);
                                  }
                                });
                                setSelectedMatches(newSelected);
                              }}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>Date</TableCell>
                          <TableCell>Transaction</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {suggestion.matches.map((match) => {
                          const key = getTxnKey(match);
                          return (
                            <TableRow key={key}>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedMatches.has(key)}
                                  onChange={() => handleSelectMatch(match)}
                                  size="small"
                                />
                              </TableCell>
                              <TableCell>{formatDate(match.date)}</TableCell>
                              <TableCell>
                                <Typography variant="body2">{match.name}</Typography>
                                {match.account_number && (
                                  <Typography variant="caption" color="text.secondary">
                                    ****{match.account_number}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2" fontWeight="medium">
                                  {formatCurrencyValue(match.price)}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      {/* Add Pattern Dialog */}
      <Dialog open={addPatternOpen} onClose={() => setAddPatternOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Custom Duplicate Pattern</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Pattern Name"
              value={newPattern.patternName}
              onChange={(e) => setNewPattern({ ...newPattern, patternName: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Regex Pattern"
              value={newPattern.patternRegex}
              onChange={(e) => setNewPattern({ ...newPattern, patternRegex: e.target.value })}
              fullWidth
              required
              helperText="PostgreSQL regex (e.g., 'העברה.*Interactive' or '\\d{4}')"
            />
            <TextField
              label="Description"
              value={newPattern.description}
              onChange={(e) => setNewPattern({ ...newPattern, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />
            <FormControl fullWidth>
              <InputLabel>Match Type</InputLabel>
              <Select
                value={newPattern.matchType}
                onChange={(e) => setNewPattern({ ...newPattern, matchType: e.target.value })}
                label="Match Type"
              >
                {MATCH_TYPES.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Override Category (Optional)</InputLabel>
              <Select
                value={newPattern.overrideCategory}
                onChange={(e) => setNewPattern({ ...newPattern, overrideCategory: e.target.value })}
                label="Override Category (Optional)"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {CATEGORY_OVERRIDES.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddPatternOpen(false)}>Cancel</Button>
          <Button
            onClick={handleAddPattern}
            variant="contained"
            disabled={!newPattern.patternName || !newPattern.patternRegex || !newPattern.matchType}
          >
            Add Pattern
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PatternSuggestionsPanel;
