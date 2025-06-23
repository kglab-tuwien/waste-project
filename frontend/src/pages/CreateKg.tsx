import React, { useState } from 'react';

import { Alert, Box } from '@mui/material';

import { createLayer } from '../api';
import { CountItem } from '../components/CountItem';
import { LayerSelect } from '../components/LayerSelect';
import { Inputs } from '../types';

export function CreateKg() {
  const [check, setCheck] = useState(true);
  const onSubmit = async (data: Inputs) => {
    await createLayer(data.layer, data.limit || undefined);
  };
  return (
    <Box
      display={'flex'}
      height={'100vh'}
      width={'100vw'}
      flexDirection={'column'}
      alignItems={'center'}
      justifyContent={'center'}
    >
      <Box
        height={'fit-content'}
        width={'fit-content'}
        my={4}
        display="flex"
        alignItems="center"
        gap={4}
        p={2}
        sx={{ border: '2px solid grey' }}
      >
        <LayerSelect onSubmit={onSubmit} hasLimit={true} hasButton={true} />
      </Box>
      {!check && <Alert severity="error">Invalid combination</Alert>}

      <Box display={'flex'} justifyContent={'space-between'} width={'95vw'}>
        <CountItem layer={'LAYER_1'} />
        <CountItem layer={'LAYER_2'} />
        <CountItem layer={'LAYER_PREEXISTING'} />
        <CountItem layer={'LAYER_GREEDY'} />
        <CountItem layer={'LAYER_BACKTRACKING'} />
        <CountItem layer={'LAYER_VISUAL'} />
        <CountItem layer={'LAYER_LS_STOCHASTIC_BAYESIAN_PROB'} />
        <CountItem layer={'LAYER_LS_CLASSIFICATION'} />
      </Box>
    </Box>
  );
}
