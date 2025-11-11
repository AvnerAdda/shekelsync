import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Grid,
  Card,
  CardContent,
  IconButton,
  Chip,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItem,
  ListItemText,
  Divider,
  Breadcrumbs,
  Link,
  Fade,
  Zoom,
} from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import {
  ArrowBack as BackIcon,
  TrendingUp as TrendIcon,
  ShoppingCart as ShoppingIcon,
  Close as CloseIcon,
  ChevronRight as ChevronRightIcon,
  ZoomIn as ZoomInIcon,
  MonetizationOn as IncomeIcon,
  TrendingUp as InvestmentIcon,
  InfoOutlined as InfoOutlinedIcon,
  Category as CategoryOutlined,
} from '@mui/icons-material';
import * as MuiIcons from '@mui/icons-material';
import { useFinancePrivacy } from '@app/contexts/FinancePrivacyContext';
import { apiClient } from '@/lib/api-client';

// Helper component to render Material-UI icon dynamically from icon name string
const CategoryIcon: React.FC<{ iconName?: string | null; color?: string | null; size?: number }> = ({
  iconName,
  color,
  size = 20
}) => {
  if (!iconName) {
    return <CategoryOutlined sx={{ color: color || 'inherit', fontSize: size }} />;
  }

  // Dynamically access the icon from MuiIcons
  const IconComponent = (MuiIcons as any)[iconName] || CategoryOutlined;
  return <IconComponent sx={{ color: color || 'inherit', fontSize: size }} />;
};

interface Subcategory {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
  count: number;
  total: number;
}

interface BreakdownData {
  byCategory: Array<{
    parentId: number;
    category: string;
    color?: string | null;
    icon?: string | null;
    description?: string | null;
    total: number;
    count: number;
    subcategories: Subcategory[];
  }>;
  byVendor: Array<{
    vendor: string;
    total: number;
    count: number;
    institution?: {
      id: number;
      vendor_code: string;
      display_name_he: string;
      display_name_en: string;
      logo_url?: string;
      institution_type: string;
    };
  }>;
  byMonth: Array<{ month: string; total: number; inflow?: number; outflow?: number }>;
}

interface BreakdownSummary {
  total: number;
  count: number;
  average: number;
  min: number;
  max: number;
}

interface BreakdownPanelProps {
  breakdowns: BreakdownData;
  startDate: Date;
  endDate: Date;
  categoryType: 'expense' | 'income' | 'investment';
  summary?: BreakdownSummary;
}

interface DrillLevel {
  type: 'parent' | 'subcategory';
  parentId?: number;
  parentName?: string;
  subcategoryId?: number;
  subcategoryName?: string;
}

const BreakdownPanel: React.FC<BreakdownPanelProps> = ({
  breakdowns,
  startDate,
  endDate,
  categoryType,
  summary,
}) => {
  const [view, setView] = useState<'overview' | 'category' | 'vendor' | 'timeline'>('overview');
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([]);
  const [categoryDetails, setCategoryDetails] = useState<any>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const theme = useTheme();
  const { formatCurrency } = useFinancePrivacy();
  const categoryBreakdown = breakdowns?.byCategory ?? [];
  const vendorBreakdown = breakdowns?.byVendor ?? [];
  const monthlyBreakdown = breakdowns?.byMonth ?? [];

  // Get configuration based on category type
  const config = {
    expense: {
      title: 'Expenses Breakdown',
      chartTitle: 'Expenses by Category',
      icon: <ShoppingIcon sx={{ mr: 0.5, fontSize: 18 }} />,
      color: 'error' as const,
    },
    income: {
      title: 'Income Breakdown',
      chartTitle: 'Income by Category',
      icon: <IncomeIcon sx={{ mr: 0.5, fontSize: 18 }} />,
      color: 'success' as const,
    },
    investment: {
      title: 'Investment Breakdown',
      chartTitle: 'Investments by Category',
      icon: <InvestmentIcon sx={{ mr: 0.5, fontSize: 18 }} />,
      color: 'primary' as const,
    },
  };

  const currentConfig = config[categoryType];

  const formatCurrencyValue = (value: number, options?: Partial<{ minimumFractionDigits: number; maximumFractionDigits: number }>) =>
    formatCurrency(value, {
      absolute: true,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 0,
    });

  const fetchCategoryDetails = async (parentId?: number, subcategoryId?: number, categoryName?: string) => {
    console.log('Fetching details for:', { parentId, subcategoryId, categoryName, categoryType });
    setIsZooming(true);

    try {
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        type: categoryType,
      });

      if (subcategoryId) {
        params.append('subcategoryId', subcategoryId.toString());
      } else if (parentId) {
        params.append('parentId', parentId.toString());
      } else if (categoryName) {
        params.append('category', categoryName);
      }

      const response = await apiClient.get(`/api/analytics/category-details?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = response.data as any;
      console.log('Category details:', data);
      setCategoryDetails(data);
      setDetailsModalOpen(true);
    } catch (error) {
      console.error('Error fetching category details:', error);
      alert('Failed to load category details. Check console for details.');
    } finally {
      setTimeout(() => setIsZooming(false), 300);
    }
  };

  const handleDrillDown = (parentId: number, parentName: string) => {
    setIsZooming(true);
    setDrillStack([...drillStack, { type: 'parent', parentId, parentName }]);
    setTimeout(() => setIsZooming(false), 300);
  };

  const handleSubcategoryClick = (subcategoryId: number, subcategoryName: string) => {
    setIsZooming(true);
    const currentLevel = drillStack[drillStack.length - 1];
    setDrillStack([
      ...drillStack,
      {
        type: 'subcategory',
        parentId: currentLevel?.parentId,
        parentName: currentLevel?.parentName,
        subcategoryId,
        subcategoryName,
      },
    ]);
    setTimeout(() => setIsZooming(false), 300);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      // Back to top level
      setDrillStack([]);
      setDetailsModalOpen(false);
    } else if (index < drillStack.length - 1) {
      // Navigate to specific level
      setDrillStack(drillStack.slice(0, index + 1));
    }
  };

  const handleBackToParent = () => {
    if (drillStack.length > 0) {
      const newStack = drillStack.slice(0, -1);
      setDrillStack(newStack);
      setDetailsModalOpen(false);
    }
  };

  const getCurrentData = () => {
    const currentLevel = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;

    if (!currentLevel) {
      // Top level: show parent categories
      return categoryBreakdown.map(item => ({
        id: item.parentId,
        name: item.category,
        color: item.color,
        icon: item.icon,
        description: item.description,
        value: Math.abs(item.total),
        count: item.count,
        subcategories: item.subcategories,
      }));
    } else if (currentLevel.type === 'parent') {
      // Drill level 1: show subcategories from breakdown data
      const parentCategory = categoryBreakdown.find(cat => cat.parentId === currentLevel.parentId);
      if (parentCategory && parentCategory.subcategories) {
        return parentCategory.subcategories.map((sub: any) => ({
          id: sub.id,
          name: sub.name,
          color: sub.color,
          icon: sub.icon,
          description: sub.description,
          value: Math.abs(sub.total),
          count: sub.count,
        }));
      }
      return [];
    } else {
      // Subcategory level: no further drill down
      return [];
    }
  };

  const renderBreadcrumbs = () => {
    return (
      <Breadcrumbs
        separator={<ChevronRightIcon fontSize="small" />}
        sx={{ mb: 2 }}
      >
        <Link
          component="button"
          variant="body2"
          onClick={() => handleBreadcrumbClick(-1)}
          sx={{
            cursor: 'pointer',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          All Categories
        </Link>
        {drillStack.map((level, index) => (
          <Link
            key={index}
            component="button"
            variant="body2"
            onClick={() => handleBreadcrumbClick(index)}
            sx={{
              cursor: index < drillStack.length - 1 ? 'pointer' : 'default',
              textDecoration: 'none',
              fontWeight: index === drillStack.length - 1 ? 'bold' : 'normal',
              '&:hover': {
                textDecoration: index < drillStack.length - 1 ? 'underline' : 'none',
              },
            }}
          >
            {level.type === 'parent' ? level.parentName : level.subcategoryName}
          </Link>
        ))}
      </Breadcrumbs>
    );
  };

  const renderOverview = () => {
    const data = getCurrentData();
  const totalAmount = data.reduce((sum: number, item: { value: number }) => sum + item.value, 0);
    const currentLevel = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;
    const isSubcategoryLevel = currentLevel?.type === 'subcategory';

    return (
      <Fade in={!isZooming} timeout={300}>
        <Grid container spacing={3}>
          {/* Pie Chart */}
          <Grid item xs={12} md={6}>
            <Box sx={{ position: 'relative' }}>
              <Typography variant="h6" gutterBottom align="center">
                {!currentLevel
                  ? currentConfig.chartTitle
                  : currentLevel.type === 'parent'
                  ? `${currentLevel.parentName} Breakdown`
                  : `${currentLevel.subcategoryName} Details`}
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={(entry: any) => {
                      if (!totalAmount) {
                        return '0%';
                      }
                      const percent = ((entry.value / totalAmount) * 100).toFixed(0);
                      return `${percent}%`;
                    }}
                    cursor={!isSubcategoryLevel ? 'pointer' : 'default'}
                  >
                    {data.map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color || theme.palette.grey[400]}
                        onClick={() => {
                          if (!isSubcategoryLevel) {
                            // Check if this category has subcategories
                            const hasSubcategories = entry.subcategories && entry.subcategories.length > 0;

                            if (hasSubcategories) {
                              // Has subcategories - drill down
                              if (!currentLevel) {
                                handleDrillDown(entry.id, entry.name);
                              } else if (currentLevel.type === 'parent') {
                                handleSubcategoryClick(entry.id, entry.name);
                              }
                            } else {
                              // Leaf node - open details modal
                              if (!currentLevel) {
                                fetchCategoryDetails(entry.id, undefined, entry.name);
                              } else if (currentLevel.type === 'parent') {
                                fetchCategoryDetails(undefined, entry.id, entry.name);
                              }
                            }
                          }
                        }}
                        style={{ cursor: !isSubcategoryLevel ? 'pointer' : 'default' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrencyValue(value)}
                    contentStyle={{
                      backgroundColor: theme.palette.background.paper,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {!isSubcategoryLevel && (
                <Typography variant="caption" display="block" align="center" color="text.secondary">
                  <ZoomInIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                  Click to drill down or view details
                </Typography>
              )}
            </Box>
          </Grid>

          {/* Category Cards */}
          <Grid item xs={12} md={6}>
            <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 1 }}>
              {data.map((item: any, index: number) => {
                const percentage = totalAmount
                  ? ((item.value / totalAmount) * 100).toFixed(1)
                  : '0.0';
                return (
                  <Zoom in={!isZooming} timeout={200} style={{ transitionDelay: `${index * 50}ms` }} key={index}>
                    <Card
                      sx={{
                        mb: 2,
                        cursor: !isSubcategoryLevel ? 'pointer' : 'default',
                        transition: 'all 0.2s',
                        '&:hover': !isSubcategoryLevel
                          ? {
                              transform: 'translateX(4px)',
                              boxShadow: 3,
                            }
                          : {},
                      }}
                      onClick={() => {
                        if (!isSubcategoryLevel) {
                          // Check if this category has subcategories
                          const hasSubcategories = item.subcategories && item.subcategories.length > 0;

                          if (hasSubcategories) {
                            // Has subcategories - drill down
                            if (!currentLevel) {
                              handleDrillDown(item.id, item.name);
                            } else if (currentLevel.type === 'parent') {
                              handleSubcategoryClick(item.id, item.name);
                            }
                          } else {
                            // Leaf node - open details modal
                            if (!currentLevel) {
                              fetchCategoryDetails(item.id, undefined, item.name);
                            } else if (currentLevel.type === 'parent') {
                              fetchCategoryDetails(undefined, item.id, item.name);
                            }
                          }
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
                              <Typography
                                variant="body2"
                                fontWeight="bold"
                                color={categoryType === 'income' ? 'success.main' : undefined}
                              >
                                {formatCurrencyValue(item.value)}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Chip label={`${item.count} transactions`} size="small" variant="outlined" />
                              <Chip
                                label={`${percentage}%`}
                                size="small"
                                color={categoryType === 'income' ? 'success' : undefined}
                              />
                            </Box>
                          </Box>
                          {!isSubcategoryLevel && (
                            <>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!currentLevel) {
                                    fetchCategoryDetails(item.id, undefined, item.name);
                                  } else if (currentLevel.type === 'parent') {
                                    fetchCategoryDetails(undefined, item.id, item.name);
                                  }
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

  const renderCategoryView = () => {
    const data = getCurrentData();

    return (
      <Box>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(value: number) => formatCurrencyValue(value)} />
            <YAxis type="category" dataKey="name" width={150} />
            <Tooltip
              formatter={(value: number) => formatCurrencyValue(value)}
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
              }}
            />
            <Bar dataKey="value" fill={theme.palette.primary.main}>
              {data.map((entry: any, index: number) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color || theme.palette.primary.main}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  const renderVendorView = () => {
    const data = vendorBreakdown.map(item => ({
      name: item.vendor,
      value: Math.abs(item.total),
    }));

    return (
      <Grid container spacing={2}>
        {data.map((item, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="primary" gutterBottom>
                  {item.name}
                </Typography>
                <Typography
                  variant="h4"
                  fontWeight="bold"
                  color={categoryType === 'income' ? 'success.main' : undefined}
                >
                  {formatCurrencyValue(item.value)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  };

  const renderTimelineView = () => {
    const data = monthlyBreakdown.map(item => ({
      month: item.month,
      total: item.total,
      inflow: item.inflow ?? (categoryType === 'income' ? item.total : 0),
      outflow: item.outflow ?? (categoryType === 'expense' ? item.total : 0),
    }));

    const hasInflow = data.some(entry => (entry.inflow ?? 0) > 0);
    const hasOutflow = data.some(entry => (entry.outflow ?? 0) > 0);
    const shouldFallbackToTotal = !hasInflow && !hasOutflow;

    return (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis tickFormatter={(value: number) => formatCurrencyValue(value)} />
          <Tooltip
            formatter={(value: number) => formatCurrencyValue(value)}
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
            }}
          />
          <Legend />
          {shouldFallbackToTotal ? (
            <Line
              type="monotone"
              dataKey="total"
              stroke={theme.palette.primary.main}
              strokeWidth={2}
              name={currentConfig.title}
            />
          ) : (
            <>
              {hasOutflow && (
                <Line
                  type="monotone"
                  dataKey="outflow"
                  stroke={theme.palette.error.main}
                  strokeWidth={2}
                  name={categoryType === 'income' ? 'Outflow' : currentConfig.title}
                />
              )}
              {hasInflow && (
                <Line
                  type="monotone"
                  dataKey="inflow"
                  stroke={theme.palette.success.main}
                  strokeWidth={2}
                  name={categoryType === 'expense' ? 'Income' : 'Inflow'}
                />
              )}
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    );
  };

  return (
    <Paper sx={{ p: 3 }}>
      {summary && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Total {categoryType === 'income' ? 'Income' : categoryType === 'investment' ? 'Movement' : 'Spent'}
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {formatCurrencyValue(summary.total)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Transactions
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {summary.count}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  Average
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {formatCurrencyValue(summary.average)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {drillStack.length > 0 && (
            <IconButton onClick={handleBackToParent} size="small">
              <BackIcon />
            </IconButton>
          )}
          <Typography variant="h6">{currentConfig.title}</Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(e, newView) => newView && setView(newView)}
          size="small"
        >
          <ToggleButton value="overview">
            {currentConfig.icon}
            Overview
          </ToggleButton>
          <ToggleButton value="category">Category</ToggleButton>
          <ToggleButton value="vendor">Vendor</ToggleButton>
          <ToggleButton value="timeline">
            <TrendIcon sx={{ mr: 0.5, fontSize: 18 }} />
            Timeline
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {drillStack.length > 0 && renderBreadcrumbs()}

      {view === 'overview' && renderOverview()}
      {view === 'category' && renderCategoryView()}
      {view === 'vendor' && renderVendorView()}
      {view === 'timeline' && renderTimelineView()}

      {/* Category Details Modal */}
      <Dialog
        open={detailsModalOpen}
        onClose={() => {
          setDetailsModalOpen(false);
          setDrillStack([]);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              {renderBreadcrumbs()}
            </Box>
            <IconButton
              onClick={() => {
                setDetailsModalOpen(false);
                setDrillStack([]);
              }}
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {categoryDetails && (
            <Box>
              {/* Summary */}
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">
                        Total {categoryType === 'income' ? 'Income' : categoryType === 'investment' ? 'Invested' : 'Spent'}
                      </Typography>
                      <Typography
                        variant="h6"
                        fontWeight="bold"
                        color={categoryType === 'income' ? 'success.main' : undefined}
                      >
                        {formatCurrencyValue(categoryDetails.summary.total)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">
                        Transactions
                      </Typography>
                      <Typography variant="h6" fontWeight="bold">
                        {categoryDetails.summary.count}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="caption" color="text.secondary">
                        Average
                      </Typography>
                      <Typography variant="h6" fontWeight="bold">
                        {formatCurrencyValue(categoryDetails.summary.average)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>

              {/* Subcategories (if viewing parent) */}
              {categoryDetails.subcategories && categoryDetails.subcategories.length > 0 && (
                <>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    Subcategories
                  </Typography>
                  <Grid container spacing={1} sx={{ mb: 3 }}>
                    {categoryDetails.subcategories.map((sub: any, index: number) => (
                      <Grid item xs={12} key={index}>
                        <Box
                          sx={{
                            p: 2,
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 1,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': {
                              backgroundColor: theme.palette.action.hover,
                              transform: 'translateX(4px)',
                            },
                          }}
                          onClick={() => handleSubcategoryClick(sub.id, sub.name)}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {sub.name}
                            </Typography>
                            <Chip label={`${sub.count} transactions`} size="small" variant="outlined" />
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" fontWeight="bold">
                              {formatCurrencyValue(sub.total)}
                            </Typography>
                            <ChevronRightIcon color="action" />
                          </Box>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </>
              )}

              {/* By Vendor */}
              {categoryDetails.byVendor && categoryDetails.byVendor.length > 0 && (
                <>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    By Vendor
                  </Typography>
                  <Grid container spacing={1} sx={{ mb: 3 }}>
                    {categoryDetails.byVendor.map((vendor: any, index: number) => (
                      <Grid item xs={6} key={index}>
                        <Box
                          sx={{
                            p: 1,
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 1,
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Typography variant="body2">
                            {vendor.institution?.display_name_he || vendor.vendor}
                          </Typography>
                          <Typography variant="body2" fontWeight="bold">
                            {formatCurrencyValue(vendor.total)}
                          </Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </>
              )}

              {/* By Card */}
              {categoryDetails.byCard && categoryDetails.byCard.length > 0 && (
                <>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    By Card
                  </Typography>
                  <Grid container spacing={1} sx={{ mb: 3 }}>
                    {categoryDetails.byCard.map((card: any, index: number) => (
                      <Grid item xs={6} key={index}>
                        <Box
                          sx={{
                            p: 1,
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 1,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Box>
                            <Typography variant="body2" fontWeight="medium" sx={{ fontFamily: 'monospace' }}>
                              ****{card.accountNumber}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {card.institution?.display_name_he || card.vendor}
                            </Typography>
                          </Box>
                          <Typography variant="body2" fontWeight="bold">
                            {formatCurrencyValue(card.total)}
                          </Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </>
              )}

              {/* Recent Transactions */}
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Recent Transactions
              </Typography>
              <List dense>
                {categoryDetails.transactions.map((txn: any, index: number) => (
                  <React.Fragment key={index}>
                    <ListItem>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2">{txn.name}</Typography>
                            {txn.account_number && (
                              <Chip
                                label={`****${txn.account_number}`}
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.7rem',
                                  height: 20,
                                  fontFamily: 'monospace',
                                  backgroundColor: 'rgba(156, 163, 175, 0.1)',
                                }}
                              />
                            )}
                          </Box>
                        }
                        secondary={`${new Date(txn.date).toLocaleDateString()} • ${txn.vendor}`}
                      />
                      <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={categoryType === 'income' ? 'success.main' : undefined}
                      >
                        {formatCurrencyValue(Math.abs(txn.price))}
                      </Typography>
                    </ListItem>
                    {index < categoryDetails.transactions.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Paper>
  );
};

export default BreakdownPanel;
