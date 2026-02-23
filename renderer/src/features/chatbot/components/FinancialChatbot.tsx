import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Fab,
  Drawer,
  Typography,
  IconButton,
  TextField,
  Paper,
  Avatar,
  CircularProgress,
  Chip,
  Divider,
  useTheme,
  Alert,
  alpha,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  Tooltip,
  Collapse,
  styled,
} from '@mui/material';
import ReactMarkdown from 'react-markdown';
import {
  Chat as ChatIcon,
  Close as CloseIcon,
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  Lock as LockIcon,
  Add as AddIcon,
  History as HistoryIcon,
  Delete as DeleteIcon,
  ExpandLess,
  ExpandMore,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useChatbotPermissions } from '@app/contexts/ChatbotPermissionsContext';
import { useAuth } from '@app/contexts/AuthContext';
import LicenseReadOnlyAlert, { isLicenseReadOnlyError } from '@renderer/shared/components/LicenseReadOnlyAlert';
import { useDonationStatus } from '@renderer/features/support';

// Styled markdown container for assistant messages
const MarkdownContent = styled(Box)(({ theme }) => ({
  '& p': {
    margin: '0 0 0.5em 0',
    '&:last-child': {
      marginBottom: 0,
    },
  },
  '& ul, & ol': {
    margin: '0.5em 0',
    paddingLeft: '1.5em',
  },
  '& li': {
    marginBottom: '0.25em',
  },
  '& strong': {
    fontWeight: 600,
    color: theme.palette.mode === 'light' ? theme.palette.text.primary : 'inherit',
  },
  '& code': {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
    padding: '0.1em 0.4em',
    borderRadius: 4,
    fontSize: '0.85em',
    fontFamily: 'monospace',
  },
  '& pre': {
    backgroundColor: theme.palette.mode === 'light'
      ? alpha(theme.palette.grey[900], 0.05)
      : alpha(theme.palette.common.black, 0.3),
    padding: '0.75em',
    borderRadius: 8,
    overflow: 'auto',
    '& code': {
      backgroundColor: 'transparent',
      padding: 0,
    },
  },
  '& h1, & h2, & h3, & h4': {
    margin: '0.5em 0 0.25em 0',
    fontWeight: 600,
    color: theme.palette.mode === 'light' ? theme.palette.text.primary : 'inherit',
  },
  '& h3': {
    fontSize: '1.1em',
  },
  '& h4': {
    fontSize: '1em',
  },
  '& blockquote': {
    borderLeft: `3px solid ${theme.palette.primary.main}`,
    margin: '0.5em 0',
    paddingLeft: '1em',
    color: theme.palette.text.secondary,
  },
  '& table': {
    borderCollapse: 'collapse',
    width: '100%',
    margin: '0.5em 0',
  },
  '& th, & td': {
    border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
    padding: '0.4em 0.6em',
    textAlign: 'left',
  },
  '& th': {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
    fontWeight: 600,
  },
}));

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    toolExecutions?: Array<{
      tool: string;
      explanation: string;
      success: boolean;
    }>;
  };
}

interface Conversation {
  externalId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

const MIN_DRAWER_WIDTH = 320;
const MAX_DRAWER_WIDTH_VW = 0.8; // 80vw

const FinancialChatbot: React.FC = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation('translation', { keyPrefix: 'chatbotWidget' });
  const {
    chatbotEnabled,
    allowTransactionAccess,
    allowCategoryAccess,
    allowAnalyticsAccess,
  } = useChatbotPermissions();
  const { session } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [licenseAlertOpen, setLicenseAlertOpen] = useState(false);
  const [licenseAlertReason, setLicenseAlertReason] = useState<string | undefined>();
  const [drawerWidth, setDrawerWidth] = useState(420);
  const { status: supporterStatus } = useDonationStatus();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  // Resize handlers for draggable left edge
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const maxWidth = window.innerWidth * MAX_DRAWER_WIDTH_VW;
      setDrawerWidth(Math.min(maxWidth, Math.max(MIN_DRAWER_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const handleOpenChatbot = () => setIsOpen(true);
    window.addEventListener('openChatbotDrawer', handleOpenChatbot);
    return () => window.removeEventListener('openChatbotDrawer', handleOpenChatbot);
  }, []);

  const hasAnyPermission = allowTransactionAccess || allowCategoryAccess || allowAnalyticsAccess;
  const aiSupportLocked = supporterStatus ? !supporterStatus.canAccessAiAgent : false;
  const userDisplayName = (() => {
    if (typeof session?.user?.name === 'string' && session.user.name.trim().length > 0) {
      return session.user.name.trim();
    }
    if (typeof session?.user?.email === 'string' && session.user.email.trim().length > 0) {
      return session.user.email.trim().split('@')[0];
    }
    return null;
  })();

  // Get greeting message
  const getGreetingMessage = useCallback((): Message => {
    const greetings = {
      en: "Hi {{name}}! I'm your personal financial assistant. I'm here to help you understand your spending, spot useful patterns, and give advice tailored to you. What would you like to look at today?",
      he: "שלום! אני העוזר הפיננסי החכם שלך. אני יכול לנתח את ההוצאות שלך, למצוא דפוסים ולספק תובנות מותאמות אישית. איך אוכל לעזור לך היום?",
      fr: "Bonjour! Je suis votre assistant financier intelligent. Je peux analyser vos dépenses, trouver des tendances et fournir des insights personnalisés. Comment puis-je vous aider?",
    };

    const locale = i18n.language.substring(0, 2) as 'en' | 'he' | 'fr';
    const template = greetings[locale] || greetings.en;
    const content = template.replace('{{name}}', userDisplayName || 'there');
    return {
      id: 'greeting',
      role: 'assistant',
      content,
      timestamp: new Date(),
    };
  }, [i18n.language, userDisplayName]);

  // Initialize with greeting
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([getGreetingMessage()]);
    }
  }, [getGreetingMessage, messages.length]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const response = await apiClient.get('/api/chat/conversations?limit=10');
      if (response.ok && response.data) {
        const data = response.data as { conversations: Conversation[] };
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  // Load conversations when drawer opens
  useEffect(() => {
    if (isOpen && showHistory) {
      loadConversations();
    }
  }, [isOpen, showHistory, loadConversations]);

  // Load a specific conversation
  const loadConversation = async (convId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(`/api/chat/conversations/${convId}`);
      if (response.ok && response.data) {
        const data = response.data as {
          externalId: string;
          messages: Array<{
            id: number;
            role: 'user' | 'assistant';
            content: string;
            createdAt: string;
            metadata?: unknown;
          }>;
        };

        setConversationId(data.externalId);
        setMessages(data.messages.map(m => ({
          id: m.id.toString(),
          role: m.role,
          content: m.content,
          timestamp: new Date(m.createdAt),
          metadata: m.metadata as Message['metadata'],
        })));
        setShowHistory(false);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
      setError('Failed to load conversation');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a conversation
  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await apiClient.delete(`/api/chat/conversations/${convId}`);
      if (!response.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          return;
        }
      }
      setConversations(prev => prev.filter(c => c.externalId !== convId));
      if (conversationId === convId) {
        startNewChat();
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  // Start a new chat
  const startNewChat = () => {
    setConversationId(null);
    setMessages([getGreetingMessage()]);
    setError(null);
    setShowHistory(false);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || !hasAnyPermission || aiSupportLocked) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.post('/api/chat', {
        message: inputValue,
        conversationId,
        permissions: {
          allowTransactionAccess,
          allowCategoryAccess,
          allowAnalyticsAccess,
        },
        locale: i18n.language.substring(0, 2),
      });

      if (!response.ok) {
        // Check for license read-only error
        const licenseCheck = isLicenseReadOnlyError(response.data);
        if (licenseCheck.isReadOnly) {
          setLicenseAlertReason(licenseCheck.reason);
          setLicenseAlertOpen(true);
          setIsLoading(false);
          return;
        }
        const supportError = response.data as { code?: string; details?: { requiredDonation?: boolean } };
        if (supportError?.code === 'DONATION_REQUIRED') {
          throw new Error(
            t('errors.donationRequired', {
              defaultValue: 'AI Agent access requires a verified donation.',
            }),
          );
        }
        const errorData = response.data as { error?: string; retryAfter?: number };
        throw new Error(errorData?.error || 'Failed to get response');
      }

      const data = response.data as {
        response: string;
        conversationId: string;
        metadata?: {
          toolExecutions?: Array<{
            tool: string;
            explanation: string;
            success: boolean;
          }>;
        };
      };

      // Update conversation ID if this is a new conversation
      if (data.conversationId && data.conversationId !== conversationId) {
        setConversationId(data.conversationId);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        metadata: data.metadata,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error('Chat error:', err);
      const errorMsg = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMsg);

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMsg.includes('rate')
          ? t('errors.rateLimited')
          : t('errors.generic'),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleRetry = () => {
    if (messages.length >= 2) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMessage) {
        // Remove the last error message and retry
        setMessages(prev => prev.slice(0, -1));
        setInputValue(lastUserMessage.content);
      }
    }
  };

  const suggestedQuestions = [
    ...(t('suggestions.items', { returnObjects: true }) as string[]),
  ];

  // Don't render if chatbot is disabled
  if (!chatbotEnabled) {
    return null;
  }

  return (
    <>
      {/* Floating Chat Button */}
      <Fab
        color="primary"
        aria-label="chat"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
          background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
          boxShadow: `0 8px 32px 0 ${alpha(theme.palette.primary.main, 0.4)}`,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: 'scale(1.1) rotate(5deg)',
            boxShadow: `0 12px 40px 0 ${alpha(theme.palette.primary.main, 0.6)}`,
          }
        }}
        onClick={() => setIsOpen(true)}
      >
        <ChatIcon />
      </Fab>

      {/* Chat Drawer */}
      <Drawer
        anchor="right"
        open={isOpen}
        onClose={() => setIsOpen(false)}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: drawerWidth },
            display: 'flex',
            flexDirection: 'column',
            zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
            bgcolor: (theme) => theme.palette.mode === 'light'
              ? theme.palette.background.paper
              : alpha(theme.palette.background.paper, 0.95),
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'light'
              ? alpha(theme.palette.grey[400], 0.3)
              : alpha(theme.palette.divider, 0.1),
          },
        }}
        sx={{
          zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
        }}
      >
        {/* Resize Handle */}
        <Box
          onMouseDown={handleResizeMouseDown}
          sx={{
            display: { xs: 'none', sm: 'block' },
            position: 'absolute',
            top: 0,
            left: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 1,
            '&:hover, &:active': {
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.2),
            },
            transition: 'background-color 0.2s',
          }}
        />

        {/* Header */}
        <Box
          sx={{
            p: 2,
            background: (theme) => `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)`,
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid',
            borderColor: (theme) => alpha(theme.palette.divider, 0.1),
            color: theme.palette.text.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar sx={{
              bgcolor: 'transparent',
              background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
              width: 40,
              height: 40
            }}>
              <BotIcon />
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
                {t('header.title')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />
                {t('header.subtitle')}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('actions.newChat')}>
              <IconButton
                onClick={startNewChat}
                size="small"
                sx={{ color: 'text.secondary' }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('actions.history')}>
              <IconButton
                onClick={() => {
                  setShowHistory(!showHistory);
                  if (!showHistory) loadConversations();
                }}
                size="small"
                sx={{ color: showHistory ? 'primary.main' : 'text.secondary' }}
              >
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton
              onClick={() => setIsOpen(false)}
              size="small"
              sx={{
                color: 'text.secondary',
                '&:hover': {
                  color: 'error.main',
                  bgcolor: (theme) => alpha(theme.palette.error.main, 0.1),
                }
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Conversation History Panel */}
        <Collapse in={showHistory}>
          <Box
            sx={{
              maxHeight: 200,
              overflowY: 'auto',
              bgcolor: (theme) => alpha(theme.palette.background.default, 0.5),
              borderBottom: '1px solid',
              borderColor: (theme) => alpha(theme.palette.divider, 0.1),
            }}
          >
            {loadingConversations ? (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <CircularProgress size={20} />
              </Box>
            ) : conversations.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                {t('history.empty')}
              </Typography>
            ) : (
              <List dense disablePadding>
                {conversations.map((conv) => (
                  <ListItem
                    key={conv.externalId}
                    disablePadding
                    sx={{
                      bgcolor: conv.externalId === conversationId
                        ? (theme) => alpha(theme.palette.primary.main, 0.1)
                        : 'transparent',
                    }}
                  >
                    <ListItemButton onClick={() => loadConversation(conv.externalId)}>
                      <ListItemText
                        primary={conv.title || t('history.untitled')}
                        secondary={new Date(conv.updatedAt).toLocaleDateString()}
                        primaryTypographyProps={{ noWrap: true, fontSize: '0.875rem' }}
                        secondaryTypographyProps={{ fontSize: '0.7rem' }}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => deleteConversation(conv.externalId, e)}
                          sx={{ opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </Collapse>

        {/* Messages Area */}
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            p: 2,
            bgcolor: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {messages.map((message) => (
            <Box
              key={message.id}
              sx={{
                display: 'flex',
                justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
                alignItems: 'flex-end',
                gap: 1,
              }}
            >
              {message.role === 'assistant' && (
                <Avatar sx={{
                  bgcolor: 'transparent',
                  background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
                  width: 28,
                  height: 28,
                  mb: 0.5
                }}>
                  <BotIcon sx={{ fontSize: 16 }} />
                </Avatar>
              )}
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  maxWidth: '75%',
                  bgcolor: message.role === 'user'
                    ? 'transparent'
                    : (theme) => theme.palette.mode === 'light'
                      ? alpha(theme.palette.grey[100], 0.95)
                      : alpha(theme.palette.background.paper, 0.6),
                  background: message.role === 'user'
                    ? `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`
                    : undefined,
                  backdropFilter: 'blur(10px)',
                  color: message.role === 'user'
                    ? theme.palette.common.white
                    : theme.palette.text.primary,
                  borderRadius: message.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                  boxShadow: (theme) => theme.palette.mode === 'light'
                    ? `0 2px 8px 0 ${alpha(theme.palette.common.black, 0.08)}`
                    : `0 4px 12px 0 ${alpha(theme.palette.common.black, 0.05)}`,
                  border: '1px solid',
                  borderColor: (theme) => message.role === 'user'
                    ? 'transparent'
                    : theme.palette.mode === 'light'
                      ? alpha(theme.palette.grey[400], 0.3)
                      : alpha(theme.palette.divider, 0.1),
                }}
              >
                {message.role === 'assistant' ? (
                  <MarkdownContent>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </MarkdownContent>
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    {message.content}
                  </Typography>
                )}
                {/* Show tool executions if any */}
                {message.metadata?.toolExecutions && message.metadata.toolExecutions.length > 0 && (
                  <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                    {message.metadata.toolExecutions.map((tool, idx) => (
                      <Chip
                        key={idx}
                        size="small"
                        label={tool.explanation}
                        color={tool.success ? 'success' : 'error'}
                        variant="outlined"
                        sx={{ mr: 0.5, mb: 0.5, fontSize: '0.65rem' }}
                      />
                    ))}
                  </Box>
                )}
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 0.5,
                    opacity: 0.7,
                    fontSize: '0.65rem',
                    textAlign: message.role === 'user' ? 'right' : 'left',
                    color: 'inherit'
                  }}
                >
                  {message.timestamp.toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Typography>
              </Paper>
              {message.role === 'user' && (
                <Avatar sx={{
                  bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.1),
                  color: 'secondary.main',
                  width: 28,
                  height: 28,
                  mb: 0.5
                }}>
                  <PersonIcon sx={{ fontSize: 16 }} />
                </Avatar>
              )}
            </Box>
          ))}

          {isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Avatar sx={{
                bgcolor: 'transparent',
                background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
                width: 28,
                height: 28
              }}>
                <BotIcon sx={{ fontSize: 16 }} />
              </Avatar>
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  borderRadius: '20px 20px 20px 4px',
                  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.6),
                  backdropFilter: 'blur(10px)',
                  border: '1px solid',
                  borderColor: (theme) => alpha(theme.palette.divider, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <CircularProgress size={16} thickness={5} />
                <Typography variant="caption" color="text.secondary">
                  {t('status.thinking')}
                </Typography>
              </Paper>
            </Box>
          )}

          {/* Error with retry button */}
          {error && !isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Chip
                icon={<RefreshIcon />}
                label={t('actions.retry')}
                onClick={handleRetry}
                color="warning"
                variant="outlined"
                size="small"
              />
            </Box>
          )}

          <div ref={messagesEndRef} />
        </Box>

        {/* No Permissions Warning */}
        {!hasAnyPermission && (
          <Alert severity="warning" icon={<LockIcon />} sx={{ mx: 2 }}>
            <Typography variant="body2" fontWeight="bold">
              {t('warnings.title')}
            </Typography>
            <Typography variant="caption">
              {t('warnings.description')}
            </Typography>
          </Alert>
        )}

        {/* Suggested Questions */}
        {aiSupportLocked && (
          <Alert severity="info" icon={<LockIcon />} sx={{ mx: 2 }}>
            <Typography variant="body2" fontWeight="bold">
              {t('errors.donationRequired', {
                defaultValue: 'AI Agent access requires a verified donation.',
              })}
            </Typography>
          </Alert>
        )}

        {/* Suggested Questions */}
        {messages.length === 1 && hasAnyPermission && !aiSupportLocked && (
          <Box
            sx={{
              p: 2,
              bgcolor: 'transparent',
            }}
          >
            <Typography variant="caption" color="text.secondary" gutterBottom sx={{ fontWeight: 600, ml: 1 }}>
              {t('suggestions.title')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {suggestedQuestions.map((question, idx) => (
                <Chip
                  key={idx}
                  label={question}
                  size="small"
                  onClick={() => setInputValue(question)}
                  sx={{
                    cursor: 'pointer',
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                    color: 'primary.main',
                    fontWeight: 500,
                    border: '1px solid',
                    borderColor: 'transparent',
                    transition: 'all 0.2s',
                    '&:hover': {
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.2),
                      borderColor: 'primary.main',
                      transform: 'translateY(-1px)'
                    }
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        <Divider sx={{ borderColor: (theme) => alpha(theme.palette.divider, 0.1) }} />

        {/* Input Area */}
        <Box
          sx={{
            p: 2,
            bgcolor: (theme) => theme.palette.mode === 'light'
              ? alpha(theme.palette.grey[100], 0.8)
              : alpha(theme.palette.background.paper, 0.4),
            backdropFilter: 'blur(10px)',
            borderTop: '1px solid',
            borderColor: (theme) => theme.palette.mode === 'light'
              ? alpha(theme.palette.grey[300], 0.5)
              : 'transparent',
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <TextField
              fullWidth
              multiline
              maxRows={3}
              placeholder={hasAnyPermission && !aiSupportLocked ? t('input.placeholderEnabled') : t('input.placeholderDisabled')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading || !hasAnyPermission || aiSupportLocked}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.5),
                  backdropFilter: 'blur(5px)',
                  transition: 'all 0.2s',
                  '& fieldset': {
                    borderColor: (theme) => alpha(theme.palette.divider, 0.2),
                  },
                  '&:hover fieldset': {
                    borderColor: 'primary.main',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'primary.main',
                    borderWidth: 2,
                  },
                },
              }}
            />
            <IconButton
              color="primary"
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading || !hasAnyPermission || aiSupportLocked}
              sx={{
                bgcolor: 'transparent',
                background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
                color: theme.palette.common.white,
                width: 40,
                height: 40,
                transition: 'all 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                  boxShadow: `0 4px 12px 0 ${alpha(theme.palette.primary.main, 0.4)}`
                },
                '&.Mui-disabled': {
                  background: (theme) => alpha(theme.palette.action.disabledBackground, 0.5),
                  color: (theme) => theme.palette.action.disabled
                },
              }}
            >
              <SendIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, ml: 1, fontSize: '0.7rem' }}>
            {hasAnyPermission && !aiSupportLocked ? t('hints.enabled') : t('hints.disabled')}
          </Typography>
        </Box>
      </Drawer>

      <LicenseReadOnlyAlert
        open={licenseAlertOpen}
        onClose={() => setLicenseAlertOpen(false)}
        reason={licenseAlertReason}
      />
    </>
  );
};

export default FinancialChatbot;
