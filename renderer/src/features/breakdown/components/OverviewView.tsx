import React from 'react';
import {
  Box,
  Grid,
  Typography,
  Card,
  CardContent,
  Chip,
  IconButton,
  Fade,
  Zoom,
  useTheme,
  alpha,
} from '@mui/material';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, PieLabelRenderProps } from 'recharts';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CategoryIcon from './CategoryIcon';
import { CategoryType, DrillLevel, FormatCurrencyFn, OverviewDataItem } from '../types';
import { getBreakdownStrings } from '../strings';

interface OverviewViewProps {
  data: OverviewDataItem[];
  currentLevel: DrillLevel | null;
  isZooming: boolean;
  categoryType: CategoryType;
  chartTitle: string;
  parentTitle: (name: string) => string;
  subcategoryTitle: (name: string) => string;
  pendingBreakdownLabel: (processed: number, pending: number) => string;
  formatCurrencyValue: FormatCurrencyFn;
  onDrillDown: (parentId: number, parentName: string) => void;
  onSubcategoryClick: (subcategoryId: number, subcategoryName: string) => void;
  onLeafClick: (params: { parentId?: number; subcategoryId?: number; categoryName?: string }) => void;
  getCategoryTransactionCounts: (categoryId: number, isSubcategory?: boolean) => {
    processedCount: number;
    pendingCount: number;
    total: number;
  };
}

const OverviewView: React.FC<OverviewViewProps> = ({
  data,
  currentLevel,
  isZooming,
  categoryType,
  chartTitle,
  parentTitle,
  subcategoryTitle,
  pendingBreakdownLabel,
  formatCurrencyValue,
  onDrillDown,
  onSubcategoryClick,
  onLeafClick,
  getCategoryTransactionCounts,
}) => {
  const theme = useTheme();
  const strings = getBreakdownStrings();
  const generalStrings = strings.general;
  const timelineStrings = strings.timeline;
  const computeDelta = React.useCallback((current: number, previous?: number) => {
    if (!previous || previous === 0) {
      return null;
    }
    return ((current - previous) / previous) * 100;
  }, []);
  const isSubcategoryLevel = currentLevel?.type === 'subcategory';
  const totalAmount = React.useMemo(() => data.reduce((sum, item) => sum + item.value, 0), [data]);
  const getHeaderTitle = () => {
    if (!currentLevel) {
      return chartTitle;
    }
    if (currentLevel.type === 'parent') {
      return parentTitle(currentLevel.parentName || '');
    }
    return subcategoryTitle(currentLevel.subcategoryName || '');
  };

  const headerTitle = getHeaderTitle();

  const buildLeafParams = (id: number, name: string) => {
    if (!currentLevel) {
      return { parentId: id, categoryName: name };
    }

    if (currentLevel.type === 'parent') {
      return { subcategoryId: id, categoryName: name };
    }

    return { categoryName: name };
  };

  const renderPieLabel = ({ value }: PieLabelRenderProps) => {
    if (!totalAmount || typeof value !== 'number') {
      return '0%';
    }
    const percent = ((value / totalAmount) * 100).toFixed(0);
    return `${percent}%`;
  };

  return (
    <Fade in={!isZooming} timeout={300}>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Box sx={{ position: 'relative' }}>
            <Typography variant="h6" gutterBottom align="center">
              {headerTitle}
            </Typography>
            <Box sx={{ position: 'relative', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data as any}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={110}
                    paddingAngle={2}
                    stroke="none"
                    cursor={!isSubcategoryLevel ? 'pointer' : 'default'}
                  >
                    {data.map((entry, index) => (
                      <Cell
                        // eslint-disable-next-line react/no-array-index-key
                        key={`cell-${index}`}
                        fill={entry.color || theme.palette.grey[400]}
                        onClick={() => {
                          if (isSubcategoryLevel) {
                            return;
                          }

                          const hasSubcategories = entry.subcategories && entry.subcategories.length > 0;
                          if (hasSubcategories) {
                            if (!currentLevel) {
                              onDrillDown(entry.id, entry.name);
                            } else if (currentLevel.type === 'parent') {
                              onSubcategoryClick(entry.id, entry.name);
                            }
                          } else {
                            onLeafClick(buildLeafParams(entry.id, entry.name));
                          }
                        }}
                        style={{ cursor: !isSubcategoryLevel ? 'pointer' : 'default' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrencyValue(value)}
                    contentStyle={{
                      backgroundColor: alpha(theme.palette.background.paper, 0.8),
                      backdropFilter: 'blur(10px)',
                      borderRadius: 12,
                      border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
                      color: theme.palette.text.primary,
                      boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                      padding: '8px 12px',
                    }}
                    itemStyle={{ color: theme.palette.text.primary, fontSize: '0.875rem', fontWeight: 600 }}
                    labelStyle={{ color: theme.palette.text.secondary, fontSize: '0.75rem', marginBottom: '4px' }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center Text Overlay */}
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  pointerEvents: 'none',
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1, mb: 0.5 }}>
                  Total
                </Typography>
                <Typography variant="h6" fontWeight={700} sx={{ color: theme.palette.text.primary }}>
                  {formatCurrencyValue(totalAmount)}
                </Typography>
              </Box>
            </Box>
            {!isSubcategoryLevel && (
              <Typography variant="caption" display="block" align="center" color="text.secondary">
                <ZoomInIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                {timelineStrings.hint}
              </Typography>
            )}
          </Box>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 1 }}>
            {data.map((item, index) => {
              const percentage = totalAmount ? ((item.value / totalAmount) * 100).toFixed(1) : '0.0';
              const delta = computeDelta(item.value, item.previousValue);
              
              let counts;
              if (!currentLevel) {
                counts = getCategoryTransactionCounts(item.id, false);
              } else if (currentLevel.type === 'parent') {
                counts = getCategoryTransactionCounts(item.id, true);
              } else {
                counts = { processedCount: 0, pendingCount: 0, total: 0 };
              }

              return (
                <Zoom in={!isZooming} timeout={200} style={{ transitionDelay: `${index * 50}ms` }} key={item.id}>
                  <Card
                    sx={{
                      mb: 2,
                      cursor: !isSubcategoryLevel ? 'pointer' : 'default',
                      transition: 'all 0.2s',
                      background: alpha(theme.palette.background.paper, 0.6),
                      backdropFilter: 'blur(10px)',
                      border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                      borderRadius: 2,
                      '&:hover':
                        !isSubcategoryLevel
                          ? {
                              transform: 'translateX(4px)',
                              boxShadow: theme.shadows[4],
                              background: alpha(theme.palette.background.paper, 0.8),
                            }
                          : {},
                    }}
                    onClick={() => {
                      if (isSubcategoryLevel) {
                        return;
                      }

                      const hasSubcategories = item.subcategories && item.subcategories.length > 0;
                      if (hasSubcategories) {
                        if (!currentLevel) {
                          onDrillDown(item.id, item.name);
                        } else if (currentLevel.type === 'parent') {
                          onSubcategoryClick(item.id, item.name);
                        }
                      } else {
                        onLeafClick(buildLeafParams(item.id, item.name));
                      }
                    }}
                  >
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <CategoryIcon iconName={item.icon} color={item.color} size={24} />
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="body2" fontWeight="medium" noWrap>
                          {item.name}
                        </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography
                                variant="body2"
                                fontWeight="bold"
                                color={categoryType === 'income' ? 'success.main' : undefined}
                              >
                                {formatCurrencyValue(item.value)}
                              </Typography>
                              {delta !== null && (
                                <Chip
                                  label={`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`}
                                  size="small"
                                  color={(() => {
                                    if (categoryType === 'expense') {
                                      return delta >= 0 ? 'error' : 'success';
                                    }
                                    return delta >= 0 ? 'success' : 'error';
                                  })()}
                                  sx={{
                                    borderRadius: 1,
                                    height: 20,
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                  }}
                                />
                              )}
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                              <Chip
                                label={`${item.count} ${generalStrings.transactions}`}
                                size="small"
                                variant="outlined"
                                sx={{
                                  borderRadius: 1,
                                  height: 20,
                                  fontSize: '0.7rem',
                                  borderColor: alpha(theme.palette.divider, 0.2),
                                  background: alpha(theme.palette.background.paper, 0.4),
                                }}
                              />
                              {counts.pendingCount > 0 && (
                              <Chip
                                label={pendingBreakdownLabel(counts.processedCount, counts.pendingCount)}
                                size="small"
                                color="warning"
                                variant="outlined"
                                sx={{ 
                                  fontSize: '0.7rem',
                                  borderRadius: 1,
                                  height: 20,
                                }}
                              />
                              )}
                            </Box>
                            <Chip
                              label={`${percentage}%`}
                              size="small"
                              color={categoryType === 'income' ? 'success' : undefined}
                              sx={{
                                borderRadius: 1,
                                height: 20,
                                fontSize: '0.7rem',
                                fontWeight: 600,
                              }}
                            />
                          </Box>
                        </Box>
                        {!isSubcategoryLevel && (
                          <>
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                onLeafClick(buildLeafParams(item.id, item.name));
                              }}
                              sx={{ color: 'action.active' }}
                            >
                              <InfoOutlinedIcon fontSize="small" />
                            </IconButton>
                            <ChevronRightIcon color="action" />
                          </>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                </Zoom>
              );
            })}
          </Box>
        </Grid>
      </Grid>
    </Fade>
  );
};

export default OverviewView;
