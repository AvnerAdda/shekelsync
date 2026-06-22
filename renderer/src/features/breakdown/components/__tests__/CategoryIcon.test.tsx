import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CategoryIcon from '../CategoryIcon';

describe('CategoryIcon', () => {
  it('renders a registered schema icon', () => {
    render(<CategoryIcon iconName="Restaurant" />);
    expect(screen.getByTestId('RestaurantIcon')).toBeInTheDocument();
  });

  it('uses the category fallback for unknown legacy icons', () => {
    render(<CategoryIcon iconName="LegacyCustomIcon" />);
    expect(screen.getByTestId('CategoryIcon')).toBeInTheDocument();
  });
});
