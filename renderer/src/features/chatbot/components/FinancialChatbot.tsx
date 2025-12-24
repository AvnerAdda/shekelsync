import React, { useState, useRef, useEffect } from 'react';
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
} from '@mui/material';
import {
  Chat as ChatIcon,
  Close as CloseIcon,
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api-client';
import { useChatbotPermissions } from '@app/contexts/ChatbotPermissionsContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const FinancialChatbot: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('translation', { keyPrefix: 'chatbotWidget' });
  const {
    chatbotEnabled,
    allowTransactionAccess,
    allowCategoryAccess,
    allowAnalyticsAccess,
  } = useChatbotPermissions();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! 👋 I\'m your smart financial assistant. I can help you understand your expenses, find spending patterns, and provide personalized recommendations. How can I help you today?',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const hasAnyPermission = allowTransactionAccess || allowCategoryAccess || allowAnalyticsAccess;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || !hasAnyPermission) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await apiClient.post('/api/chat', {
        message: inputValue,
        conversationHistory: messages,
        permissions: {
          allowTransactionAccess,
          allowCategoryAccess,
          allowAnalyticsAccess,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = response.data as any;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an issue. Please try again.',
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
            width: { xs: '100%', sm: 400 },
            display: 'flex',
            flexDirection: 'column',
            zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.8),
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid',
            borderColor: (theme) => alpha(theme.palette.common.white, 0.1),
          },
        }}
        sx={{
          zIndex: (muiTheme) => muiTheme.zIndex.drawer + 2,
        }}
      >
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
          <IconButton
            onClick={() => setIsOpen(false)}
            sx={{
              color: 'text.secondary',
              transition: 'all 0.2s',
              '&:hover': {
                color: 'error.main',
                bgcolor: (theme) => alpha(theme.palette.error.main, 0.1),
                transform: 'rotate(90deg)'
              }
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

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
                    : (theme) => alpha(theme.palette.background.paper, 0.6),
                  background: message.role === 'user' 
                    ? `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`
                    : undefined,
                  backdropFilter: 'blur(10px)',
                  color: message.role === 'user'
                    ? theme.palette.common.white
                    : theme.palette.text.primary,
                  borderRadius: message.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                  boxShadow: (theme) => `0 4px 12px 0 ${alpha(theme.palette.common.black, 0.05)}`,
                  border: '1px solid',
                  borderColor: (theme) => message.role === 'user' ? 'transparent' : alpha(theme.palette.divider, 0.1),
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {message.content}
                </Typography>
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
                  {message.timestamp.toLocaleTimeString('he-IL', {
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
                }}
              >
                <CircularProgress size={16} thickness={5} />
              </Paper>
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
        {messages.length === 1 && hasAnyPermission && (
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
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.4),
            backdropFilter: 'blur(10px)',
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <TextField
              fullWidth
              multiline
              maxRows={3}
              placeholder={hasAnyPermission ? t('input.placeholderEnabled') : t('input.placeholderDisabled')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading || !hasAnyPermission}
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
              disabled={!inputValue.trim() || isLoading || !hasAnyPermission}
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
          {hasAnyPermission && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, ml: 1, fontSize: '0.7rem' }}>
              {t('hints.enabled')}
            </Typography>
          )}
          {!hasAnyPermission && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1, ml: 1, fontSize: '0.7rem' }}>
              {t('hints.disabled')}
            </Typography>
          )}
        </Box>
      </Drawer>
    </>
  );
};

export default FinancialChatbot;
