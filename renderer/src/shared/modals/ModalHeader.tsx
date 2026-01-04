import React from 'react';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';

interface ModalHeaderProps {
  title: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
}

export default function ModalHeader({ title, onClose, actions }: ModalHeaderProps) {
  return (
    <DialogTitle 
      sx={{ 
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '24px',
        background: (theme) => theme.palette.mode === 'dark'
          ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)'
          : 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(139, 92, 246, 0.02) 100%)',
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        position: 'relative',
        '&::before': {
          content: '\"\"',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: (theme) => theme.palette.mode === 'dark'
            ? 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)'
            : 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
        },
      }}
    >
      <Typography 
        variant="h6" 
        component="span" 
        sx={{ 
          fontWeight: 700,
          letterSpacing: '0.02em',
          color: 'text.primary',
        }}
      >
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {actions}
        <IconButton 
          onClick={onClose}
          sx={{
            color: 'text.secondary',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              color: 'text.primary',
              backgroundColor: 'action.hover',
              transform: 'rotate(90deg)',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
    </DialogTitle>
  );
}
