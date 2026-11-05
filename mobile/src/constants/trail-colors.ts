// Display approximations of the park-sign colors, not provider-approved GIS attributes.
export const TrailColors = {
  springs: { name: 'Springs Trail', colorName: 'Orange', color: '#C95700' },
  'white-oak': { name: 'White Oak Trail', colorName: 'Light blue', color: '#73C6D5' },
  'bigleaf-magnolia': { name: 'Bigleaf Magnolia Trail', colorName: 'Dark green', color: '#24533E' },
  'turkeyfoot-utoy-creek': {
    name: 'Turkeyfoot/Utoy Creek Trail',
    colorName: 'Blue',
    color: '#2864B4',
  },
  'battle-ridge': { name: 'Battle Ridge Trail', colorName: 'Pink', color: '#D65388' },
  west: { name: 'West Trail', colorName: 'Red', color: '#C9363E' },
  terrace: { name: 'Terrace Trail', colorName: 'Purple', color: '#78479B' },
  gateway: { name: 'Gateway Trail', colorName: 'White', color: '#FFFFFF' },
  spur: { name: 'Spur Trails', colorName: 'Black', color: '#202020' },
} as const;

export const TrailCasing = '#FFFFFF';
export const GatewayCasing = '#444444';
export const OtherTrail = { name: 'Other trails', colorName: 'Gray', color: '#60646C' };
export const UnnamedConnection = {
  name: 'Unnamed connections',
  colorName: 'Gray, dashed',
  color: '#60646C',
};
