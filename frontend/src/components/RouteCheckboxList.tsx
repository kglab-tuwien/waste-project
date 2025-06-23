import * as React from 'react';
import { useEffect } from 'react';

import { Typography } from '@mui/material';
import Avatar from '@mui/material/Avatar';
import Checkbox from '@mui/material/Checkbox';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';

import { RouteInfo } from '../types';

export default function RouteCheckboxList({
  routeInfos,
  colors,
  onSelect,
}: {
  routeInfos: RouteInfo[];
  colors: string[];
  onSelect: (a: string[]) => void;
}) {
  const [checked, setChecked] = React.useState<number[]>(
    Array.from(Array(routeInfos.length).keys()),
  );
  useEffect(() => {
    setChecked(Array.from(Array(routeInfos.length).keys()));
  }, [routeInfos.length]);
  const handleToggle = (value: number) => () => {
    const currentIndex = checked.indexOf(value);
    const newChecked = [...checked];

    if (currentIndex === -1) {
      newChecked.push(value);
    } else {
      newChecked.splice(currentIndex, 1);
    }

    setChecked(newChecked);
    onSelect(newChecked.map((value) => routeInfos[value].routeId));
  };

  return (
    <List
      dense
      sx={{ width: '100%', maxWidth: 360, bgcolor: 'background.paper' }}
    >
      {routeInfos.map((value, index) => {
        const labelId = `checkbox-list-secondary-label-${index}`;
        return (
          <>
            <ListItem
              key={index}
              secondaryAction={
                <Checkbox
                  edge="end"
                  onChange={handleToggle(index)}
                  defaultChecked
                  inputProps={{ 'aria-labelledby': labelId }}
                />
              }
              disablePadding
            >
              <ListItemButton>
                <ListItemAvatar>
                  <Avatar sx={{ bgcolor: colors[index] }}>{index + 1}</Avatar>
                </ListItemAvatar>
                <ListItemText id={labelId} primary={`Route ${index + 1}`} />
              </ListItemButton>
            </ListItem>
            <Typography variant="body2" color="text.secondary">
              {value.routeType +
                ', ' +
                Math.round(value.routeLength / 1000) +
                ' km' +
                ', ' +
                value.stops +
                ' stops'}
            </Typography>
          </>
        );
      })}
    </List>
  );
}
