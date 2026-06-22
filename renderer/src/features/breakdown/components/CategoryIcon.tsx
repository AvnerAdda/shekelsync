import React from 'react';
import { resolveCategoryIcon } from './category-icon-registry';

interface CategoryIconProps {
  iconName?: string | null;
  color?: string | null;
  size?: number;
}

const CategoryIcon: React.FC<CategoryIconProps> = ({ iconName, color, size = 20 }) => {
  const IconComponent = resolveCategoryIcon(iconName);
  return <IconComponent sx={{ color: color || 'inherit', fontSize: size }} />;
};

export default CategoryIcon;
