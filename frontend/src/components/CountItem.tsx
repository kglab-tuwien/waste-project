import { useEffect, useState } from 'react';

import { Card, CardContent, Typography } from '@mui/material';

import { count } from '../api';
import { Layer } from '../layer';

export function CountItem({
  layer,
  nodeLabel,
}: {
  layer?: Layer;
  nodeLabel?: string;
}) {
  const [itemNumber, setItemNumber] = useState(-1);
  const getCount = async (layer?: Layer, nodeLabel?: string) => {
    const number = await count(layer, nodeLabel);
    setItemNumber(number);
  };
  useEffect(() => {
    (async () => {
      await getCount(layer, nodeLabel);
    })();
  }, [layer, nodeLabel]);
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography sx={{ fontSize: 14 }} color="text.secondary" gutterBottom>
          {layer || 'all layers'}
        </Typography>
        <Typography sx={{ mb: 1.5 }} color="text.secondary">
          {nodeLabel || 'all labels'}
        </Typography>
        <Typography variant="h3" component="div">
          {itemNumber}
        </Typography>
      </CardContent>
    </Card>
  );
}
