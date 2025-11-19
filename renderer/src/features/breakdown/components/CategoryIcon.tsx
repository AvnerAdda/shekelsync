import React from 'react';
import { Category as CategoryOutlined } from '@mui/icons-material';
import * as MuiIcons from '@mui/icons-material';

interface CategoryIconProps {
  iconName?: string | null;
  color?: string | null;
  size?: number;
}

const CategoryIcon: React.FC<CategoryIconProps> = ({ iconName, color, size = 20 }) => {
  if (!iconName) {
    return <CategoryOutlined sx={{ color: color || 'inherit', fontSize: size }} />;
  }

  const IconComponent = (MuiIcons as Record<string, React.ElementType>)[iconName] || CategoryOutlined;
  return <IconComponent sx={{ color: color || 'inherit', fontSize: size }} />;
};

export default CategoryIcon;
