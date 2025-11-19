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
} from '@mui/material';
import {
  Chat as ChatIcon,
  Close as CloseIcon,
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
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
    'How much did I spend this month?',
    'What category did I spend the most on?',
    'Give me savings recommendations',
    'Are there any unusual expenses?',
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
          boxShadow: 3,
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
            background: theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(62,165,77,0.3) 0%, rgba(200,250,207,0.2) 100%)'
              : 'linear-gradient(135deg, #c8facf 0%, #78e88b 100%)',
            color: theme.palette.mode === 'dark' ? theme.palette.text.primary : '#000000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BotIcon />
            <Box>
              <Typography variant="h6" fontWeight="bold">
                Financial Assistant
              </Typography>
              <Typography variant="caption">AI-Powered</Typography>
            </Box>
          </Box>
          <IconButton
            onClick={() => setIsOpen(false)}
            sx={{
              color: theme.palette.mode === 'dark' ? theme.palette.text.primary : '#000000',
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
            bgcolor: theme.palette.mode === 'dark' ? theme.palette.background.default : '#f5f5f5',
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
                alignItems: 'flex-start',
                gap: 1,
              }}
            >
              {message.role === 'assistant' && (
                <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
                  <BotIcon fontSize="small" />
                </Avatar>
              )}
              <Paper
                sx={{
                  p: 2,
                  maxWidth: '75%',
                  bgcolor: message.role === 'user'
                    ? 'primary.main'
                    : theme.palette.mode === 'dark'
                      ? theme.palette.background.paper
                      : 'white',
                  color: message.role === 'user'
                    ? theme.palette.mode === 'dark'
                      ? theme.palette.text.primary
                      : '#000000'
                    : theme.palette.text.primary,
                  borderRadius: 2,
                  boxShadow: 1,
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {message.content}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 0.5,
                    opacity: 0.7,
                    fontSize: '0.7rem',
                  }}
                >
                  {message.timestamp.toLocaleTimeString('he-IL', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Typography>
              </Paper>
              {message.role === 'user' && (
                <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                  <PersonIcon fontSize="small" />
                </Avatar>
              )}
            </Box>
          ))}

          {isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
                <BotIcon fontSize="small" />
              </Avatar>
              <Paper
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark'
                    ? theme.palette.background.paper
                    : 'white',
                }}
              >
                <CircularProgress size={20} />
              </Paper>
            </Box>
          )}

          <div ref={messagesEndRef} />
        </Box>

        {/* No Permissions Warning */}
        {!hasAnyPermission && (
          <Alert severity="warning" icon={<LockIcon />} sx={{ mx: 2 }}>
            <Typography variant="body2" fontWeight="bold">
              Limited Access
            </Typography>
            <Typography variant="caption">
              Enable data permissions in Settings to use the chatbot features.
            </Typography>
          </Alert>
        )}

        {/* Suggested Questions */}
        {messages.length === 1 && hasAnyPermission && (
          <Box
            sx={{
              p: 2,
              bgcolor: theme.palette.mode === 'dark' ? theme.palette.background.default : '#f5f5f5',
            }}
          >
            <Typography variant="caption" color="text.secondary" gutterBottom>
              Suggested questions:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {suggestedQuestions.map((question, idx) => (
                <Chip
                  key={idx}
                  label={question}
                  size="small"
                  onClick={() => setInputValue(question)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </Box>
        )}

        <Divider />

        {/* Input Area */}
        <Box
          sx={{
            p: 2,
            bgcolor: theme.palette.mode === 'dark' ? theme.palette.background.paper : 'white',
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <TextField
              fullWidth
              multiline
              maxRows={3}
              placeholder={hasAnyPermission ? 'Ask me something...' : 'Enable permissions in Settings'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading || !hasAnyPermission}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 3,
                },
              }}
            />
            <IconButton
              color="primary"
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading || !hasAnyPermission}
              sx={{
                bgcolor: 'primary.main',
                color: theme.palette.mode === 'dark' ? theme.palette.text.primary : '#000000',
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
              }}
            >
              <SendIcon />
            </IconButton>
          </Box>
          {hasAnyPermission && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              💡 The assistant analyzes your transactions and income
            </Typography>
          )}
          {!hasAnyPermission && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
              🔒 Grant data access permissions in Settings to use this feature
            </Typography>
          )}
        </Box>
      </Drawer>
    </>
  );
};

export default FinancialChatbot;
