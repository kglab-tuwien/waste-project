import React, { memo } from 'react';

import { Box, Divider, Popover, Typography } from '@mui/material';
import Avatar from '@mui/material/Avatar';
import { Chart } from 'react-google-charts';

import { getPollutionColorGradient } from './helpers';
import { colors } from '../colors';
import { PickUpInfo } from '../types';

function getAggregatedTrashForDay(
  day: PickUpInfo,
): { type: string; count: number }[] {
  const res: {
    type: string;
    count: number;
  }[] = [];
  for (const r of day.reports) {
    for (const t of r.trash) {
      let found = false;
      for (const x of res) {
        if (x.type === t.type) {
          x.count += t.count;
          found = true;
          break;
        }
      }
      if (!found) {
        res.push({ type: t.type, count: t.count });
      }
    }
  }
  return res.map((x) => ({
    type: x.type,
    count: x.count / day.reports.length,
  }));
}

function getAggregatedTrash(
  days: PickUpInfo[],
): { type: string; count: number }[] {
  const res: {
    type: string;
    count: number;
  }[] = [];
  for (const day of days) {
    getAggregatedTrashForDay(day).forEach((x) => {
      let found = false;
      for (const y of res) {
        if (y.type === x.type) {
          y.count += x.count;
          found = true;
          break;
        }
      }
      if (!found) {
        res.push({ type: x.type, count: x.count });
      }
    });
  }
  return res.map((x) => ({
    type: x.type,
    count: x.count / days.length,
  }));
}

const CircleDisplay = function ({
  individualDays,
  handlePopoverClick,
  handlePopoverClose,
  openDayPopover,
}: {
  individualDays: PickUpInfo[];
  handlePopoverClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handlePopoverClose: () => void;
  openDayPopover: HTMLElement | null;
}) {
  const [openReportPopover, setOpenReportPopover] = React.useState<any | null>(
    null,
  );
  const handleReportPopoverClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setOpenReportPopover(event.currentTarget);
  };
  const handleReportPopoverClose = () => {
    setOpenReportPopover(null);
  };
  const pollutionPieChartLegend: (number | string)[][] = [
    ['Type', 'Occurrences'],
  ];

  return (
    <Box
      display={'inline-flex'}
      alignContent={'flex-start'}
      alignSelf={'center'}
      flexDirection={'column'}
      justifyContent={'space-between'}
      width={'100%'}
      flexBasis={'max-content'}
    >
      {individualDays.length > 0 && (
        <Chart
          chartType="PieChart"
          data={pollutionPieChartLegend.concat(
            ...getAggregatedTrash(individualDays)
              .sort((a, b) => b.count - a.count)
              .map((x) => [[x.type, x.count]]),
          )}
          options={{
            title: '',
            is3D: true, // Enables 3D view
            sliceVisibilityThreshold: 0.02, // Hides slices smaller than 2%
            legend: {
              position: 'left',
              alignment: 'center',
              textStyle: {
                color: '#233238',
                fontSize: 12,
              },
            },
            pieSliceText: 'value',
            colors: colors,
            chartArea: { width: '100%' },
          }}
        />
      )}
      <Typography variant="subtitle1">
        {individualDays.length > 0 ? 'Days' : 'No data available'}
      </Typography>
      <Divider sx={{ my: 2 }} />
      <Box
        display={'inline-flex'}
        alignContent={'flex-start'}
        alignSelf={'center'}
        flexWrap={'wrap'}
        flexDirection={'row'}
        width={'100%'}
        maxHeight={'10vh'}
        minHeight={'36px'}
        sx={{ overflowY: 'scroll' }}
      >
        {individualDays &&
          individualDays.map((day) => (
            <Box sx={{}}>
              <Box
                id={'div-' + day.year + '-' + day.month + '-' + day.day}
                display={'flex'}
                alignContent={'center'}
                justifyContent={'space-between'}
                sx={{
                  margin: '3px',
                }}
                onClick={handlePopoverClick}
              >
                <Avatar
                  sx={{
                    bgcolor: getPollutionColorGradient(day.dscore),
                    color: '#000',
                    fontSize: '12px',
                    height: '33px',
                    width: '33px',
                  }}
                >
                  {day.day + '.' + day.month + '.'}
                </Avatar>
              </Box>
              <Popover
                anchorEl={openDayPopover}
                open={
                  openDayPopover != null &&
                  openDayPopover.id ===
                    'div-' + day.year + '-' + day.month + '-' + day.day
                }
                onClose={handlePopoverClose}
                anchorOrigin={{
                  vertical: 'center',
                  horizontal: 'center',
                }}
                transformOrigin={{
                  vertical: 'center',
                  horizontal: 'center',
                }}
              >
                <Box
                  m={'20px'}
                  sx={{
                    minWidth: '20vw',
                    maxWidth: '30vw',
                    overflowY: 'scroll',
                  }}
                  minHeight={'10vh'}
                  maxHeight={'40vh'}
                  paddingBottom={'18px'}
                >
                  <Typography variant={'h6'} align="center">
                    {day.year + '-' + day.month + '-' + day.day}
                  </Typography>
                  <Typography sx={{ p: 2 }}>
                    score: {Math.round(day.dscore * 1000) / 1000} <br />
                    number of reports: {day.reports.length}
                  </Typography>
                  <Chart
                    chartType="PieChart"
                    data={pollutionPieChartLegend.concat(
                      ...getAggregatedTrashForDay(day)
                        .sort((a, b) => b.count - a.count)
                        .map((x) => [[x.type, x.count]]),
                    )}
                    options={{
                      title: '',
                      is3D: true, // Enables 3D view
                      sliceVisibilityThreshold: 0.02, // Hides slices smaller than 2%
                      colors: colors,
                      pieSliceText: 'value',
                      legend: {
                        position: 'left',
                        alignment: 'center',
                        textStyle: {
                          color: '#233238',
                          fontSize: 12,
                        },
                      },
                      chartArea: { left: 0, width: '100%' },
                    }}
                  />

                  <Typography variant="subtitle1">
                    {individualDays.length > 0
                      ? 'Reports'
                      : 'No data available'}
                  </Typography>
                  <Divider sx={{ my: 2 }} />
                  <Box
                    display={'inline-flex'}
                    alignContent={'center'}
                    alignSelf={'center'}
                    flexWrap={'wrap'}
                    flexDirection={'row'}
                    justifyContent={'space-between'}
                  >
                    {day.reports &&
                      day.reports.map((report, idx) => (
                        <Box>
                          <Box
                            id={'div-' + report.rid}
                            display={'flex'}
                            alignContent={'center'}
                            justifyContent={'space-between'}
                            sx={{
                              margin: '3px',
                            }}
                            onClick={handleReportPopoverClick}
                          >
                            <Avatar
                              sx={{
                                bgcolor: getPollutionColorGradient(
                                  report.rscore,
                                ),
                                color: '#000',
                                fontSize: '12px',
                                height: '33px',
                                width: '33px',
                              }}
                            >
                              {idx}
                            </Avatar>
                          </Box>
                          <Popover
                            anchorEl={openReportPopover}
                            open={
                              openReportPopover != null &&
                              openReportPopover.id === 'div-' + report.rid
                            }
                            onClose={handleReportPopoverClose}
                            anchorOrigin={{
                              vertical: 'center',
                              horizontal: 'center',
                            }}
                            transformOrigin={{
                              vertical: 'center',
                              horizontal: 'center',
                            }}
                          >
                            <Typography sx={{ p: 2 }}>
                              <>
                                id: {report.rid} <br />
                                score: {Math.round(report.rscore * 1000) /
                                  1000}{' '}
                                <br />
                                timestamp: {report.timestamp.hour}:
                                {report.timestamp.minute}:
                                {report.timestamp.second} <br />
                                trash:{' '}
                                {report.trash.map((x) => (
                                  <>
                                    <br />
                                    {x.type + ': ' + x.count}
                                  </>
                                ))}
                              </>
                            </Typography>
                          </Popover>
                        </Box>
                      ))}
                  </Box>
                </Box>
              </Popover>
            </Box>
          ))}
      </Box>
    </Box>
  );
};

export default memo(CircleDisplay);
