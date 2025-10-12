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
} from '@mui/icons-material';

const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#FFC658', '#FF6B9D', '#C084FC', '#34D399',
  '#F87171', '#60A5FA', '#A78BFA', '#FB923C', '#2DD4BF'
];

interface Subcategory {
  id: number;
  name: string;
  count: number;
  total: number;
}

interface BreakdownData {
  byCategory: Array<{
    parentId: number;
    category: string;
    total: number;
    count: number;
    subcategories: Subcategory[];
  }>;
  byVendor: Array<{ vendor: string; total: number; count: number }>;
  byMonth: Array<{ month: string; income: number; expenses: number }>;
}

interface DetailedTransaction {
  date: string;
  name: string;
  price: number;
  vendor: string;
  category: string;
  parentCategory: string;
}

interface CostBreakdownPanelProps {
  breakdowns: BreakdownData;
  startDate: Date;
  endDate: Date;
}

interface DrillLevel {
  type: 'parent' | 'subcategory';
  parentId?: number;
  parentName?: string;
  subcategoryId?: number;
  subcategoryName?: string;
}

const CostBreakdownPanel: React.FC<CostBreakdownPanelProps> = ({
  breakdowns,
  startDate,
  endDate,
}) => {
  const [view, setView] = useState<'overview' | 'category' | 'vendor' | 'timeline'>('overview');
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([]);
  const [categoryDetails, setCategoryDetails] = useState<any>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const theme = useTheme();

  const formatCurrency = (value: number) => {
    return `₪${value.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
  };

  const fetchCategoryDetails = async (parentId?: number, subcategoryId?: number, categoryName?: string) => {
    console.log('Fetching details for:', { parentId, subcategoryId, categoryName });
    setIsZooming(true);

    try {
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      if (subcategoryId) {
        params.append('subcategoryId', subcategoryId.toString());
      } else if (parentId) {
        params.append('parentId', parentId.toString());
      } else if (categoryName) {
        params.append('category', categoryName);
      }

      const response = await fetch(`/api/analytics/category-details?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
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
    fetchCategoryDetails(parentId, undefined, parentName);
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
    fetchCategoryDetails(undefined, subcategoryId, subcategoryName);
    setTimeout(() => setIsZooming(false), 300);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      // Back to top level
      setDrillStack([]);
      setDetailsModalOpen(false);
    } else if (index < drillStack.length - 1) {
      // Navigate to specific level
      const targetLevel = drillStack[index];
      setDrillStack(drillStack.slice(0, index + 1));
      if (targetLevel.type === 'parent') {
        fetchCategoryDetails(targetLevel.parentId, undefined, targetLevel.parentName);
      } else {
        fetchCategoryDetails(undefined, targetLevel.subcategoryId, targetLevel.subcategoryName);
      }
    }
  };

  const handleBackToParent = () => {
    if (drillStack.length > 0) {
      const newStack = drillStack.slice(0, -1);
      setDrillStack(newStack);

      if (newStack.length === 0) {
        setDetailsModalOpen(false);
      } else {
        const prevLevel = newStack[newStack.length - 1];
        if (prevLevel.type === 'parent') {
          fetchCategoryDetails(prevLevel.parentId, undefined, prevLevel.parentName);
        } else {
          fetchCategoryDetails(undefined, prevLevel.subcategoryId, prevLevel.subcategoryName);
        }
      }
    }
  };

  const getCurrentData = () => {
    const currentLevel = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;

    if (!currentLevel) {
      // Top level: show parent categories
      return breakdowns.byCategory.map(item => ({
        id: item.parentId,
        name: item.category,
        value: item.total,
        count: item.count,
        subcategories: item.subcategories,
      }));
    } else if (currentLevel.type === 'parent' && categoryDetails?.subcategories) {
      // Drill level 1: show subcategories
      return categoryDetails.subcategories.map((sub: any) => ({
        id: sub.id,
        name: sub.name,
        value: sub.total,
        count: sub.count,
      }));
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
    const totalExpenses = data.reduce((sum, item) => sum + item.value, 0);
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
                  ? 'Expenses by Category'
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
                      const percent = ((entry.value / totalExpenses) * 100).toFixed(0);
                      return `${percent}%`;
                    }}
                    cursor={!isSubcategoryLevel ? 'pointer' : 'default'}
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                        onClick={() => {
                          if (!isSubcategoryLevel) {
                            if (!currentLevel) {
                              handleDrillDown(entry.id, entry.name);
                            } else if (currentLevel.type === 'parent') {
                              handleSubcategoryClick(entry.id, entry.name);
                            }
                          }
                        }}
                        style={{ cursor: !isSubcategoryLevel ? 'pointer' : 'default' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
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
                  Click on a slice to drill down
                </Typography>
              )}
            </Box>
          </Grid>

          {/* Category Cards */}
          <Grid item xs={12} md={6}>
            <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 1 }}>
              {data.map((item, index) => {
                const percentage = ((item.value / totalExpenses) * 100).toFixed(1);
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
                          if (!currentLevel) {
                            handleDrillDown(item.id, item.name);
                          } else if (currentLevel.type === 'parent') {
                            handleSubcategoryClick(item.id, item.name);
                          }
                        }
                      }}
                    >
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Box
                            sx={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              backgroundColor: COLORS[index % COLORS.length],
                              flexShrink: 0,
                            }}
                          />
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                              <Typography variant="body2" fontWeight="medium" noWrap>
                                {item.name}
                              </Typography>
                              <Typography variant="body2" fontWeight="bold">
                                {formatCurrency(item.value)}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Chip label={`${item.count} transactions`} size="small" variant="outlined" />
                              <Chip label={`${percentage}%`} size="small" />
                            </Box>
                          </Box>
                          {!isSubcategoryLevel && (
                            <ChevronRightIcon color="action" />
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
            <XAxis type="number" tickFormatter={formatCurrency} />
            <YAxis type="category" dataKey="name" width={150} />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
              }}
            />
            <Bar dataKey="value" fill={theme.palette.primary.main}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  const renderVendorView = () => {
    const data = breakdowns.byVendor.map(item => ({
      name: item.vendor,
      value: item.total,
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
                <Typography variant="h4" fontWeight="bold">
                  {formatCurrency(item.value)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  };

  const renderTimelineView = () => {
    const data = breakdowns.byMonth;

    return (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis tickFormatter={formatCurrency} />
          <Tooltip
            formatter={(value: number) => formatCurrency(value)}
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="expenses"
            stroke={theme.palette.error.main}
            strokeWidth={2}
            name="Expenses"
          />
          <Line
            type="monotone"
            dataKey="income"
            stroke={theme.palette.success.main}
            strokeWidth={2}
            name="Income"
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {drillStack.length > 0 && (
            <IconButton onClick={handleBackToParent} size="small">
              <BackIcon />
            </IconButton>
          )}
          <Typography variant="h6">Cost Breakdown</Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(e, newView) => newView && setView(newView)}
          size="small"
        >
          <ToggleButton value="overview">
            <ShoppingIcon sx={{ mr: 0.5, fontSize: 18 }} />
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
                        Total Spent
                      </Typography>
                      <Typography variant="h6" fontWeight="bold">
                        {formatCurrency(categoryDetails.summary.total)}
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
                        {formatCurrency(categoryDetails.summary.average)}
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
                              {formatCurrency(sub.total)}
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
                          <Typography variant="body2">{vendor.vendor}</Typography>
                          <Typography variant="body2" fontWeight="bold">
                            {formatCurrency(vendor.total)}
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
                              {card.vendor}
                            </Typography>
                          </Box>
                          <Typography variant="body2" fontWeight="bold">
                            {formatCurrency(card.total)}
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
                      <Typography variant="body2" fontWeight="bold">
                        {formatCurrency(Math.abs(txn.price))}
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

export default CostBreakdownPanel;
