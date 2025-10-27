import { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import { useTheme } from '@mui/material/styles';
import { useNotification } from './NotificationContext';
import ModalHeader from './ModalHeader';

interface ScraperConfig {
  options: {
    companyId: string;
    startDate: Date;
    combineInstallments: boolean;
    showBrowser: boolean;
    additionalTransactionInformation: boolean;
  };
  credentials: {
    // Common fields
    password?: string;
    nickname?: string;
    
    // ID-based authentication
    id?: string;
    
    // Username-based authentication
    username?: string;
    userCode?: string;
    
    // Additional authentication fields
    card6Digits?: string;
    nationalID?: string;
    num?: string;
    identification_code?: string;
    
    // Bank-specific
    bankAccountNumber?: string;
    
    // Email-based (oneZero)
    email?: string;
    otpCode?: string;
    otpToken?: string;
  };
}

interface ScrapeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialConfig?: ScraperConfig;
}

export default function ScrapeModal({ isOpen, onClose, onSuccess, initialConfig }: ScrapeModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showNotification } = useNotification();
  const theme = useTheme();
  const todayStr = new Date().toISOString().split('T')[0];
  const clampDateString = (value: string) => (value > todayStr ? todayStr : value);
  const defaultConfig: ScraperConfig = {
    options: {
      companyId: 'isracard',
      startDate: new Date(),
      combineInstallments: false,
      showBrowser: true,
      additionalTransactionInformation: true
    },
    credentials: {
      password: '',
      nickname: '',
      id: '',
      username: '',
      userCode: '',
      card6Digits: '',
      nationalID: '',
      num: '',
      identification_code: '',
      bankAccountNumber: '',
      email: '',
      otpCode: '',
      otpToken: ''
    }
  };
  const [config, setConfig] = useState<ScraperConfig>(initialConfig || defaultConfig);

  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
    }
  }, [initialConfig]);

  useEffect(() => {
    if (!isOpen) {
      setConfig(initialConfig || defaultConfig);
      setError(null);
      setIsLoading(false);
    }
  }, [isOpen, initialConfig]);

  const handleConfigChange = (field: string, value: any) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setConfig(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent as keyof ScraperConfig],
          [child]: value
        }
      }));
    } else {
      setConfig(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const handleScrape = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error('Failed to start scraping');
      }

      showNotification('Scraping process started successfully!', 'success');
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const renderCredentialFields = () => {
    const companyId = config.options.companyId;
    
    // Helper function to render a text field
    const renderField = (field: string, label: string, type: string = 'text', helperText?: string) => (
      <TextField
        key={field}
        label={label}
        type={type}
        value={(config.credentials as any)[field] || ''}
        onChange={(e) => handleConfigChange(`credentials.${field}`, e.target.value)}
        fullWidth
        required
        helperText={helperText}
      />
    );

    // Define credential fields for each vendor
    const vendorFields: { [key: string]: Array<{ field: string; label: string; type?: string; helperText?: string }> } = {
      // Credit Cards
      isracard: [
        { field: 'id', label: 'ID Number' },
        { field: 'card6Digits', label: 'Card 6 Digits', helperText: 'Last 6 digits of your card' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      amex: [
        { field: 'id', label: 'ID Number' },
        { field: 'card6Digits', label: 'Card 6 Digits', helperText: 'Last 6 digits of your card' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      visaCal: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      max: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      
      // Banks - Special (Discount group)
      discount: [
        { field: 'id', label: 'ID Number' },
        { field: 'password', label: 'Password', type: 'password' },
        { field: 'num', label: 'Identification Code (num)', helperText: 'User identification code provided by the bank' }
      ],
      mercantile: [
        { field: 'id', label: 'ID Number' },
        { field: 'password', label: 'Password', type: 'password' },
        { field: 'num', label: 'Identification Code (num)', helperText: 'User identification code provided by the bank' }
      ],
      
      // Banks - Hapoalim
      hapoalim: [
        { field: 'userCode', label: 'User Code' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      
      // Banks - Standard username/password
      leumi: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      mizrahi: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      otsarHahayal: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      union: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      beinleumi: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      massad: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      pagi: [
        { field: 'username', label: 'Username' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      
      // Banks - Special cases
      yahav: [
        { field: 'username', label: 'Username' },
        { field: 'nationalID', label: 'National ID' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      beyahadBishvilha: [
        { field: 'id', label: 'ID Number' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      behatsdaa: [
        { field: 'id', label: 'ID Number' },
        { field: 'password', label: 'Password', type: 'password' }
      ],
      oneZero: [
        { field: 'email', label: 'Email', type: 'email' },
        { field: 'password', label: 'Password', type: 'password' },
        { field: 'otpCode', label: 'OTP Code (if available)', helperText: 'Leave empty if using OTP token' },
        { field: 'otpToken', label: 'OTP Token (if available)', helperText: 'Long-term OTP token' }
      ]
    };

    const fields = vendorFields[companyId] || [];
    
    return (
      <>
        {fields.map(({ field, label, type, helperText }) => 
          renderField(field, label, type, helperText)
        )}
      </>
    );
  };

  const renderNewScrapeForm = () => (
    <>
      <FormControl fullWidth>
        <InputLabel>Vendor</InputLabel>
        <Select
          value={config.options.companyId}
          label="Vendor"
          onChange={(e) => handleConfigChange('options.companyId', e.target.value)}
        >
          <MenuItem disabled sx={{ fontWeight: 600, color: 'primary.main' }}>Credit Cards</MenuItem>
          <MenuItem value="isracard">Isracard</MenuItem>
          <MenuItem value="amex">American Express</MenuItem>
          <MenuItem value="visaCal">Visa CAL</MenuItem>
          <MenuItem value="max">Max</MenuItem>
          
          <MenuItem disabled sx={{ fontWeight: 600, color: 'primary.main', mt: 1 }}>Banks</MenuItem>
          <MenuItem value="hapoalim">Bank Hapoalim</MenuItem>
          <MenuItem value="leumi">Bank Leumi</MenuItem>
          <MenuItem value="discount">Discount Bank</MenuItem>
          <MenuItem value="mizrahi">Mizrahi Bank</MenuItem>
          <MenuItem value="beinleumi">Beinleumi</MenuItem>
          <MenuItem value="union">Union Bank</MenuItem>
          <MenuItem value="yahav">Bank Yahav</MenuItem>
          <MenuItem value="otsarHahayal">Bank Otsar Hahayal</MenuItem>
          <MenuItem value="mercantile">Mercantile Bank</MenuItem>
          <MenuItem value="massad">Massad Bank</MenuItem>
          <MenuItem value="beyahadBishvilha">Beyahad Bishvilha</MenuItem>
          <MenuItem value="behatsdaa">Behatsdaa</MenuItem>
          <MenuItem value="pagi">Pagi</MenuItem>
          <MenuItem value="oneZero">One Zero</MenuItem>
        </Select>
      </FormControl>

      {renderCredentialFields()}

      <TextField
        label="Start Date"
        type="date"
        value={config.options.startDate.toISOString().split('T')[0]}
        onChange={(e) => {
          const v = clampDateString(e.target.value);
          handleConfigChange('options.startDate', new Date(v));
        }}
        InputLabelProps={{
          shrink: true,
        }}
        inputProps={{ max: todayStr }}
        helperText="Transactions will be fetched from this date"
      />
    </>
  );

  const renderExistingAccountForm = () => {
    const creds = config.credentials;
    
    return (
      <>
        {creds.nickname && (
          <TextField
            label="Account Nickname"
            value={creds.nickname}
            disabled
            fullWidth
          />
        )}
        {creds.username && (
          <TextField
            label="Username"
            value={creds.username}
            disabled
            fullWidth
          />
        )}
        {creds.userCode && (
          <TextField
            label="User Code"
            value={creds.userCode}
            disabled
            fullWidth
          />
        )}
        {creds.id && (
          <TextField
            label="ID"
            value={creds.id}
            disabled
            fullWidth
          />
        )}
        {creds.email && (
          <TextField
            label="Email"
            value={creds.email}
            disabled
            fullWidth
          />
        )}
        {creds.card6Digits && (
          <TextField
            label="Card 6 Digits"
            value={creds.card6Digits}
            disabled
            fullWidth
          />
        )}
        {creds.nationalID && (
          <TextField
            label="National ID"
            value={creds.nationalID}
            disabled
            fullWidth
          />
        )}
        {creds.num && (
          <TextField
            label="Identification Code (num)"
            value={creds.num}
            disabled
            fullWidth
          />
        )}
        {creds.identification_code && (
          <TextField
            label="Identification Code"
            value={creds.identification_code}
            disabled
            fullWidth
          />
        )}
        {creds.bankAccountNumber && (
          <TextField
            label="Bank Account Number"
            value={creds.bankAccountNumber}
            disabled
            fullWidth
          />
        )}

        <TextField
          label="Start Date"
          type="date"
          value={config.options.startDate.toISOString().split('T')[0]}
          onChange={(e) => {
            const v = clampDateString(e.target.value);
            handleConfigChange('options.startDate', new Date(v));
          }}
          InputLabelProps={{
            shrink: true,
          }}
          inputProps={{ max: todayStr }}
          helperText="Transactions will be fetched from this date"
        />
      </>
    );
  };

  return (
    <Dialog 
      open={isOpen} 
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        style: {
          backgroundColor: theme.palette.background.paper,
          borderRadius: '24px',
          boxShadow: theme.palette.mode === 'dark' 
            ? '0 8px 32px rgba(0, 0, 0, 0.5)' 
            : '0 8px 32px rgba(0, 0, 0, 0.1)'
        }
      }}
    >
      <ModalHeader title="Scrape" onClose={onClose} />
      <DialogContent style={{ padding: '0 24px 24px' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          {initialConfig ? renderExistingAccountForm() : renderNewScrapeForm()}
        </Box>
      </DialogContent>
      <DialogActions style={{ padding: '16px 24px' }}>
        <Button 
          onClick={onClose}
          sx={{ color: theme.palette.text.secondary }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleScrape}
          variant="contained"
          disabled={isLoading}
          sx={{
            backgroundColor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            padding: '8px 24px',
            borderRadius: '8px',
            textTransform: 'none',
            fontWeight: 500,
            '&:hover': {
              backgroundColor: theme.palette.primary.dark,
            }
          }}
        >
          {isLoading ? 'SCRAPING...' : 'SCRAPE'}
        </Button>
      </DialogActions>
    </Dialog>
  );
} 