import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import {
  buildStatementRows,
  ColumnMapping,
  ColumnRole,
  detectHeaderRow,
  EMPTY_MAPPING,
  guessColumnMapping,
  headerLabels,
  readStatementFile,
  StatementFileError,
  StatementSheet,
} from '../statement-parser';

type Step = 'pick' | 'map' | 'review' | 'done';
type ReviewFilter = 'new' | 'duplicate' | 'invalid';

interface PreviewRow {
  index: number;
  status: ReviewFilter;
  reason?: string;
  match?: { date: string | null; name: string; status: string };
}

interface PreviewResponse {
  target: {
    vendor: string;
    nickname: string | null;
    isBank: boolean;
    accountNumber: string | null;
    accountNumberOptions: string[];
  };
  summary: {
    total: number;
    new: number;
    duplicates: number;
    invalid: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  rows: PreviewRow[];
}

export interface StatementImportResult {
  requested: number;
  inserted: number;
  skippedDuplicates: number;
  invalid: number;
}

interface ErrorBody {
  error?: string;
  code?: string | null;
}

export interface StatementImportDialogProps {
  open: boolean;
  account: { id: number; nickname?: string | null; vendor: string } | null;
  isBank: boolean;
  onClose: () => void;
  onImported: (result: StatementImportResult) => void;
}

const MAPPING_ROLES: ColumnRole[] = [
  'date',
  'description',
  'amount',
  'debit',
  'credit',
  'processedDate',
  'originalAmount',
  'originalCurrency',
  'memo',
];
const SERVER_ERROR_CODES = new Set(['no_rows', 'too_many_rows', 'credential_not_found', 'unsupported_account', 'unknown_account_number']);
const MAP_PREVIEW_ROWS = 6;
const REVIEW_ROW_LIMIT = 300;
const COMMIT_TIMEOUT_MS = 120_000;

export function StatementImportDialog({ open, account, isBank, onClose, onImported }: StatementImportDialogProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'accountsModal.statementImport' });
  const { formatCurrency } = useFinancePrivacy();

  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<StatementSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [headerDetected, setHeaderDetected] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [chargesArePositive, setChargesArePositive] = useState(!isBank);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [accountNumber, setAccountNumber] = useState<string | null>(null);
  const [forced, setForced] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<ReviewFilter>('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StatementImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setFileName('');
    setSheets([]);
    setPreview(null);
    setAccountNumber(null);
    setForced(new Set());
    setFilter('new');
    setError(null);
    setResult(null);
    setBusy(false);
    setChargesArePositive(!isBank);
  }, [open, account?.id, isBank]);

  const sheetRows = useMemo(() => sheets[sheetIndex]?.rows ?? [], [sheets, sheetIndex]);
  const labels = useMemo(() => headerLabels(sheetRows, headerRowIndex), [sheetRows, headerRowIndex]);
  const usesDebitCredit = mapping.amount === null && (mapping.debit !== null || mapping.credit !== null);
  const parsed = useMemo(
    () => buildStatementRows(sheetRows, headerRowIndex, mapping, { chargesArePositive }),
    [sheetRows, headerRowIndex, mapping, chargesArePositive],
  );
  const mappingComplete = mapping.date !== null && mapping.description !== null
    && (mapping.amount !== null || mapping.debit !== null || mapping.credit !== null);

  const applySheet = (nextSheets: StatementSheet[], index: number) => {
    const rows = nextSheets[index]?.rows ?? [];
    const detected = detectHeaderRow(rows);
    const headerIndex = detected >= 0 ? detected : 0;
    setSheetIndex(index);
    setHeaderRowIndex(headerIndex);
    setHeaderDetected(detected >= 0);
    setMapping(guessColumnMapping(rows[headerIndex] ?? []));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const nextSheets = await readStatementFile(file);
      // Start on the first sheet that looks like a statement.
      const firstWithHeader = nextSheets.findIndex((sheet) => detectHeaderRow(sheet.rows) >= 0);
      setSheets(nextSheets);
      setFileName(file.name);
      applySheet(nextSheets, firstWithHeader >= 0 ? firstWithHeader : 0);
      setStep('map');
    } catch (fileError) {
      const code = fileError instanceof StatementFileError ? fileError.code : 'unreadable';
      setError(t(`fileErrors.${code}`));
    } finally {
      setBusy(false);
    }
  };

  const describeServerError = (body: ErrorBody | null | undefined) => {
    const code = body?.code || '';
    return SERVER_ERROR_CODES.has(code) ? t(`serverErrors.${code}`) : t('serverErrors.generic');
  };

  const requestPreview = async (nextAccountNumber: string | null) => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<PreviewResponse | ErrorBody>('/api/statement-import/preview', {
        credentialId: account.id,
        accountNumber: nextAccountNumber,
        rows: parsed.rows,
      });
      if (!response.ok) {
        setError(describeServerError(response.data as ErrorBody));
        return;
      }
      const data = response.data as PreviewResponse;
      setPreview(data);
      setAccountNumber(data.target.accountNumber);
      setForced(new Set());
      setFilter(data.summary.new > 0 ? 'new' : data.summary.duplicates > 0 ? 'duplicate' : 'invalid');
      setStep('review');
    } catch {
      setError(t('serverErrors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!account || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiClient.post<StatementImportResult | ErrorBody>(
        '/api/statement-import/commit',
        {
          credentialId: account.id,
          accountNumber,
          rows: parsed.rows,
          includeDuplicateIndexes: Array.from(forced),
        },
        { timeoutMs: COMMIT_TIMEOUT_MS },
      );
      if (!response.ok) {
        setError(describeServerError(response.data as ErrorBody));
        return;
      }
      const data = response.data as StatementImportResult;
      setResult(data);
      setStep('done');
      onImported(data);
    } catch {
      setError(t('serverErrors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const setRole = (role: ColumnRole, value: string) => {
    const index = value === '' ? null : Number(value);
    setMapping((current) => {
      const next = { ...current, [role]: index };
      // One amount source: a single column, or debit + credit.
      if (role === 'amount' && index !== null) {
        next.debit = null;
        next.credit = null;
      }
      if ((role === 'debit' || role === 'credit') && index !== null) {
        next.amount = null;
      }
      return next;
    });
  };

  const formatAmount = (value: number) => (Number.isFinite(value) ? formatCurrency(value) : '—');

  const reviewRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((row) => row.status === filter);
  }, [preview, filter]);

  const importCount = (preview?.summary.new ?? 0) + forced.size;

  const renderPick = () => (
    <Stack spacing={2}>
      <Typography variant="body2">{t('pick.intro')}</Typography>
      <Box>
        <Button
          component="label"
          variant="contained"
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon />}
          disabled={busy}
        >
          {t('pick.choose')}
          <input
            hidden
            type="file"
            accept=".csv,.txt,.xls,.xlsx"
            data-testid="statement-file-input"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('pick.formats')}
      </Typography>
    </Stack>
  );

  const renderMap = () => (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {fileName}
      </Typography>
      {!headerDetected ? <Alert severity="warning">{t('map.headerNotFound')}</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {sheets.length > 1 ? (
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>{t('map.sheet')}</InputLabel>
            <Select
              label={t('map.sheet')}
              value={String(sheetIndex)}
              onChange={(event) => applySheet(sheets, Number(event.target.value))}
            >
              {sheets.map((sheet, index) => (
                <MenuItem key={sheet.name} value={String(index)}>
                  {sheet.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        <TextField
          size="small"
          type="number"
          label={t('map.headerRow')}
          value={headerRowIndex + 1}
          onChange={(event) => {
            const next = Math.max(1, Math.min(sheetRows.length, Number(event.target.value) || 1)) - 1;
            setHeaderRowIndex(next);
            setMapping(guessColumnMapping(sheetRows[next] ?? []));
          }}
          sx={{ width: 160 }}
        />
      </Stack>

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' } }}>
        {MAPPING_ROLES.map((role) => (
          <FormControl key={role} size="small">
            <InputLabel>{t(`roles.${role}`)}</InputLabel>
            <Select
              label={t(`roles.${role}`)}
              value={mapping[role] === null ? '' : String(mapping[role])}
              onChange={(event) => setRole(role, String(event.target.value))}
              inputProps={{ 'data-testid': `map-${role}` }}
            >
              <MenuItem value="">
                <em>{t('map.none')}</em>
              </MenuItem>
              {labels.map((label, index) => (
                <MenuItem key={`${label}-${index}`} value={String(index)}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ))}
      </Box>

      {!usesDebitCredit ? (
        <FormControlLabel
          control={<Switch checked={chargesArePositive} onChange={(event) => setChargesArePositive(event.target.checked)} />}
          label={t('map.chargesArePositive')}
        />
      ) : null}

      <Typography variant="body2">
        {t('map.found', { count: parsed.rows.length, skipped: parsed.skipped })}
      </Typography>
      {parsed.rows.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('table.date')}</TableCell>
              <TableCell>{t('table.description')}</TableCell>
              <TableCell align="right">{t('table.amount')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {parsed.rows.slice(0, MAP_PREVIEW_ROWS).map((row, index) => (
              <TableRow key={`${row.date}-${index}`}>
                <TableCell>{row.date}</TableCell>
                <TableCell>{row.description || '—'}</TableCell>
                <TableCell align="right" sx={{ color: row.amount < 0 ? 'error.main' : 'success.main', direction: 'ltr' }}>
                  {formatAmount(row.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Stack>
  );

  const renderReview = () => {
    if (!preview) return null;
    const { summary, target } = preview;
    return (
      <Stack spacing={2}>
        {target.accountNumberOptions.length > 1 ? (
          <FormControl size="small" sx={{ maxWidth: 260 }}>
            <InputLabel>{t('review.accountNumber')}</InputLabel>
            <Select
              label={t('review.accountNumber')}
              value={accountNumber ?? ''}
              onChange={(event) => void requestPreview(String(event.target.value))}
            >
              {target.accountNumberOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        {summary.firstDate && summary.lastDate ? (
          <Typography variant="body2">{t('review.range', { from: summary.firstDate, to: summary.lastDate })}</Typography>
        ) : null}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_, value) => value && setFilter(value)}
        >
          <ToggleButton value="new">{t('review.new', { count: summary.new })}</ToggleButton>
          <ToggleButton value="duplicate">{t('review.duplicates', { count: summary.duplicates })}</ToggleButton>
          <ToggleButton value="invalid">{t('review.invalid', { count: summary.invalid })}</ToggleButton>
        </ToggleButtonGroup>
        {filter === 'duplicate' && summary.duplicates > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t('review.duplicatesHint')}
          </Typography>
        ) : null}
        <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {filter === 'duplicate' ? <TableCell padding="checkbox">{t('table.importAnyway')}</TableCell> : null}
                <TableCell>{t('table.date')}</TableCell>
                <TableCell>{t('table.description')}</TableCell>
                <TableCell align="right">{t('table.amount')}</TableCell>
                {filter !== 'new' ? <TableCell>{t('table.note')}</TableCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {reviewRows.slice(0, REVIEW_ROW_LIMIT).map((previewRow) => {
                const row = parsed.rows[previewRow.index];
                return (
                  <TableRow key={previewRow.index}>
                    {filter === 'duplicate' ? (
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={forced.has(previewRow.index)}
                          onChange={(event) => {
                            setForced((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(previewRow.index);
                              else next.delete(previewRow.index);
                              return next;
                            });
                          }}
                          slotProps={{ input: { 'aria-label': t('table.importAnyway') } }}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>{row?.date}</TableCell>
                    <TableCell>{row?.description || '—'}</TableCell>
                    <TableCell align="right" sx={{ direction: 'ltr' }}>{row ? formatAmount(row.amount) : '—'}</TableCell>
                    {filter === 'duplicate' && previewRow.match ? (
                      <TableCell>
                        {t('review.matches', { name: previewRow.match.name, date: previewRow.match.date ?? '' })}
                      </TableCell>
                    ) : null}
                    {filter === 'invalid' ? <TableCell>{t(`reasons.${previewRow.reason ?? 'invalid_date'}`)}</TableCell> : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
        {reviewRows.length > REVIEW_ROW_LIMIT ? (
          <Typography variant="caption" color="text.secondary">
            {t('review.truncated', { shown: REVIEW_ROW_LIMIT, count: reviewRows.length })}
          </Typography>
        ) : null}
      </Stack>
    );
  };

  const renderDone = () => (
    <Stack spacing={1}>
      <Alert severity="success">{t('done.imported', { count: result?.inserted ?? 0 })}</Alert>
      {result && result.skippedDuplicates > 0 ? (
        <Typography variant="body2">{t('done.skipped', { count: result.skippedDuplicates })}</Typography>
      ) : null}
      {result && result.requested > result.inserted ? (
        <Typography variant="body2">{t('done.merged', { count: result.requested - result.inserted })}</Typography>
      ) : null}
    </Stack>
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {t('title')}
        {account?.nickname ? (
          <Chip label={account.nickname} size="small" sx={{ marginInlineStart: 1 }} />
        ) : null}
      </DialogTitle>
      <DialogContent dividers>
        {step === 'pick' ? renderPick() : null}
        {step === 'map' ? renderMap() : null}
        {step === 'review' ? renderReview() : null}
        {step === 'done' ? renderDone() : null}
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        {step === 'done' ? (
          <Button variant="contained" onClick={onClose}>
            {t('actions.close')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('actions.cancel')}
            </Button>
            {step === 'map' ? (
              <>
                <Button onClick={() => setStep('pick')} disabled={busy}>
                  {t('actions.otherFile')}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => void requestPreview(null)}
                  disabled={busy || !mappingComplete || parsed.rows.length === 0}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {t('actions.check')}
                </Button>
              </>
            ) : null}
            {step === 'review' ? (
              <>
                <Button onClick={() => setStep('map')} disabled={busy}>
                  {t('actions.back')}
                </Button>
                <Button
                  variant="contained"
                  onClick={() => void handleCommit()}
                  disabled={busy || importCount === 0}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {t('actions.import', { count: importCount })}
                </Button>
              </>
            ) : null}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default StatementImportDialog;
