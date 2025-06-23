import React from 'react';

import {
  Button,
  FormControlLabel,
  FormGroup,
  Radio,
  RadioGroup,
  TextField,
} from '@mui/material';
import { SubmitHandler, useForm } from 'react-hook-form';

import { Layer } from '../layer';
import { Inputs } from '../types';

export function LayerSelect(
  // eslint-disable-next-line prettier/prettier
  {
    hasButton = false,
    onSubmit,
    hasLimit,
    enabledLayers = [
      'LAYER_1',
      'LAYER_2',
      'LAYER_PREEXISTING',
      'LAYER_GREEDY',
      'LAYER_BACKTRACKING',
      'LAYER_LS_STOCHASTIC_BAYESIAN_PROB',
      'LAYER_LS_CLASSIFICATION',
    ],
  }: {
    hasButton?: boolean;
    onSubmit: SubmitHandler<Inputs>;
    hasLimit?: boolean;
    enabledLayers?: Layer[];
  },
) {
  const labelDict = {
    LAYER_1: 'Layer 1',
    LAYER_2: 'Layer 2',
    LAYER_3: 'Layer 3',
    LAYER_4: 'Layer 4',
    LAYER_VISUAL: 'Visualization',
    LAYER_PREEXISTING: 'Preexisting Routes',
    LAYER_GREEDY: 'Optimized: Greedy',
    LAYER_BACKTRACKING: 'Optimized: Backtracking',
    LAYER_LS_CLASSIFICATION: 'Optimized: Local Search',
    LAYER_LS_STOCHASTIC_BAYESIAN_PROB: 'Optimized: Local Search (Stochastic)',
  };
  const form = useForm<Inputs>({
    mode: 'onChange',
  });
  const { register, handleSubmit } = form;
  return (
    <FormGroup>
      <RadioGroup
        defaultValue={enabledLayers[0]}
        onChange={hasButton ? () => {} : handleSubmit(onSubmit)}
      >
        {enabledLayers.map((layer) => (
          <FormControlLabel
            control={<Radio />}
            value={layer}
            label={labelDict[layer]}
            {...register('layer')}
          />
        ))}
      </RadioGroup>
      {hasLimit && (
        <TextField
          id="outlined-basic"
          label="Days (data limit)"
          variant="outlined"
          defaultValue={null}
          {...register('limit')}
        />
      )}
      {hasButton && (
        <Button
          type="submit"
          onClick={handleSubmit(onSubmit)}
          variant="outlined"
          color="error"
        >
          Submit
        </Button>
      )}
    </FormGroup>
  );
}
