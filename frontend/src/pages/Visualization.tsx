import React, { useEffect, useState } from 'react';

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Drawer,
  InputAdornment,
  TextField,
  ToggleButton,
  Typography,
} from '@mui/material';
import { grey } from '@mui/material/colors';
import { ArrowDropDownIcon } from '@mui/x-date-pickers';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  ScaleControl,
  TileLayer,
  useMap,
} from 'react-leaflet';
import styled from 'styled-components';

import {
  getDays,
  getPickUpById,
  getRoutes,
  getSolutionDetails,
  getStaticMarkers,
} from '../api';
import { colors } from '../colors';
import AlphaSlider from '../components/AlphaSlider';
import CircleDisplay from '../components/CircleDisplay';
import DayPicker from '../components/DayPicker';
import { getPollutionColorGradient } from '../components/helpers';
import { LayerSelect } from '../components/LayerSelect';
import RouteCheckboxList from '../components/RouteCheckboxList';
import { Layer } from '../layer';
import { Inputs, PickUpInfo, RouteInfo, SolutionInfo } from '../types';

const getColors = () => {
  return colors;
};

const StyledPopup = styled(Popup)`
  min-width: 20vw;
  max-width: 30vw;
  display: flex;
  flex-direction: column;
  align-content: flex-start;
  .leaflet-popup-tip {
    background: rgba(0, 0, 0, 0) !important;
    box-shadow: none !important;
  }
  overflow: hidden;
`;

const center = [47.982172843227616, 18.185882089383355];

export function Visualization() {
  function SetViewOnClick(internalAttributes: {
    coords: [number, number, number?];
    isTransposed: boolean;
  }) {
    const map = useMap();
    if (clickOnTranspose) {
      map.setView(internalAttributes.coords, map.getZoom());
      map.setZoom(internalAttributes.isTransposed ? 14 : 11);
      setClickOnTranspose(false);
    }
    return null;
  }
  const [alpha, setAlpha] = useState(0);
  const [averagePickUpScore, setAveragePickUpScore] = useState<number>(-1);
  const [clickOnTranspose, setClickOnTranspose] = useState(false);
  const [toggleVienna, setToggleVienna] = useState(true);
  const [offset, setOffset] = useState<[number, number]>([0, 0]);
  const [scale, setScale] = useState(1);
  const [weightPerStop, setWeightPerStop] = useState(36);
  const [co2ePerKg, setco2ePerKg] = useState(305); // currently computed based on co2 only using https://www.sciencedirect.com/science/article/pii/S0956053X05000280
  const [co2ePerKm, setco2ePerKm] = useState(470); // direct co2e, < 18t https://www.umweltbundesamt.at/fileadmin/site/themen/mobilitaet/daten/ekz_fzkm_verkehrsmittel.pdf

  const [individualDays, setIndividualDays] = useState<PickUpInfo[]>([]);
  const [solutionDetails, setSolutionDetails] = useState<SolutionInfo>();
  const [staticMarkers, setStaticMarkers] = useState<{
    base: [number, number];
    dropOff: [number, number];
  }>();
  const [layer, setLayer] = useState<Layer>('LAYER_PREEXISTING');
  const [openDayPopover, setOpenDayPopover] = React.useState<any | null>(null);
  const handlePopoverClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpenDayPopover(event.currentTarget);
  };
  const handlePopoverClose = () => {
    setOpenDayPopover(null);
  };

  useEffect(() => {
    (async () => {
      const markers = await getStaticMarkers();
      markers.dropOff[0] =
        (markers.dropOff[0] - center[0]) * scale + center[0] + offset[0];
      markers.dropOff[1] =
        (markers.dropOff[1] - center[1]) * scale + center[1] + offset[1];
      markers.base[0] =
        (markers.base[0] - center[0]) * scale + center[0] + offset[0];
      markers.base[1] =
        (markers.base[1] - center[1]) * scale + center[1] + offset[1];
      setStaticMarkers(markers);
    })();
  }, [scale, offset]);
  const [days, setDays] = useState<string[]>([]);
  const [day, setDay] = useState<string | undefined>();
  useEffect(() => {
    (async () => {
      const days = await getDays(layer);
      setDays(days);
      if (day && !days.includes(day)) {
        setDay(days[0]);
      }
    })();
  }, [day, layer]);
  const [colors, setColors] = useState<string[]>(getColors());

  const [routes, setRoutes] = useState<
    {
      routeInfo: RouteInfo;
      routeCoords: {
        lat: number;
        lng: number;
        id: string;
        score: number | null;
      }[];
    }[]
  >([]);
  const [isRouteVisible, setIsRouteVisible] = useState<string[]>([]);
  const onSubmit = async (data: Inputs) => {
    setLayer(data.layer);
  };

  useEffect(() => {
    (async () => {
      if (day === undefined) return;
      const routes = await getRoutes(day, alpha, layer);
      routes.forEach((route) => {
        route.routeCoords = route.routeCoords.map((node) => ({
          lat: (node.lat - center[0]) * scale + center[0] + offset[0],
          lng: (node.lng - center[1]) * scale + center[1] + offset[1],
          id: node.id,
          score: node.score,
        }));
      });
      setIsRouteVisible(routes.map((route) => route.routeInfo.routeId));
      setRoutes(routes);
    })();
  }, [scale, offset, layer, day, alpha]);

  useEffect(() => {
    (async () => {
      const res = await getSolutionDetails(layer, alpha);
      setSolutionDetails(res);
    })();
  }, [layer, alpha]);

  const icon = new L.Icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png',
    iconSize: [23, 35],
    iconAnchor: [11, 34],
  });

  return (
    <Box
      display={'flex'}
      height={'100vh'}
      width={'100vw'}
      flexDirection={'column'}
      alignItems={'center'}
      justifyContent={'center'}
    >
      <Drawer
        open={true}
        anchor="right"
        variant="persistent"
        ModalProps={{ keepMounted: true }}
      >
        <Box
          display={'flex'}
          flexDirection={'column'}
          alignItems={'center'}
          justifyContent={'flex-start'}
          height={'100vh'}
          gap={3}
          mx={2}
          p={2}
        >
          <ToggleButton
            value="check"
            selected={toggleVienna}
            onChange={() => {
              setToggleVienna(!toggleVienna);
              setOffset(
                !toggleVienna
                  ? [0, 0]
                  : [48.209033 - center[0], 16.351449 - center[1]],
              );
              setScale(toggleVienna ? 1 / 10 : 1);
              setClickOnTranspose(true);
            }}
          >
            {toggleVienna ? 'Transpose to Vienna' : 'No transpose'}
          </ToggleButton>
          <LayerSelect
            onSubmit={onSubmit}
            enabledLayers={[
              'LAYER_PREEXISTING',
              'LAYER_GREEDY',
              //'LAYER_BACKTRACKING',
              'LAYER_LS_STOCHASTIC_BAYESIAN_PROB',
              'LAYER_LS_CLASSIFICATION',
            ]}
          ></LayerSelect>
          <AlphaSlider
            disabled={layer === 'LAYER_PREEXISTING'}
            alphaValues={[
              0, 250, 500, 750, 1000, 1250, 1500, 2179, 4358, 6538, 999999,
            ]}
            onSelect={setAlpha}
            weightPerStop={weightPerStop}
            co2ePerKg={co2ePerKg}
          />

          <DayPicker onSelect={setDay} days={days}></DayPicker>
          {solutionDetails && (
            <Box
              sx={{
                mt: '10px',
                width: '100%',
                borderTop: '5px solid ' + grey[500],
              }}
              py={2}
            >
              <Typography variant="h6"> Solution details </Typography>
              <Typography variant="body1" align="left">
                {'total distance: ' +
                  Math.round(solutionDetails?.routeLength / 10) / 100 +
                  'km'}
                <br />

                {'total duration: ' +
                  Math.round(solutionDetails?.routeDuration / 3600) +
                  'h ' +
                  Math.round((solutionDetails?.routeDuration % 3600) / 60) +
                  'min'}
                <br />
                {'clean volume: ' +
                  solutionDetails?.cleanStops +
                  '/' +
                  solutionDetails?.potentialCleanStops +
                  ' bins'}
                <br />
                {'total volume: ' + solutionDetails?.stops + ' bins'}
                <br />
                <br />
                {'total CO2e by transport: ' +
                  Math.round(
                    ((solutionDetails?.routeLength / 1000) * co2ePerKm) / 10000,
                  ) /
                    100 +
                  ' t'}
                <br />
                {'CO2e reduced by recycling: ' +
                  -Math.round(
                    (solutionDetails?.cleanStops * weightPerStop * co2ePerKg) /
                      10000,
                  ) /
                    100 +
                  ' t'}
                <br />
                {'CO2e from disposed waste: ' +
                  Math.round(
                    ((solutionDetails?.stops - solutionDetails?.cleanStops) *
                      weightPerStop *
                      co2ePerKg) /
                      10000,
                  ) /
                    100 +
                  ' t'}

                <br />
                {'total emissions: ' +
                  Math.round(
                    ((solutionDetails?.stops - solutionDetails?.cleanStops) *
                      weightPerStop *
                      co2ePerKg +
                      (solutionDetails?.routeLength / 1000) * co2ePerKm) /
                      10000,
                  ) /
                    100 +
                  ' t'}
              </Typography>
            </Box>
          )}

          <Accordion
            sx={{
              width: '100%',
              my: 0,
            }}
          >
            <AccordionSummary
              expandIcon={<ArrowDropDownIcon />}
              aria-controls="panel1-content"
              id="panel1-header"
            >
              <Typography variant={'subtitle1'}>Settings</Typography>
            </AccordionSummary>
            <AccordionDetails
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <Box
                display={'flex'}
                justifyContent={'space-between'}
                alignItems={'center'}
                width={'100%'}
              >
                <Typography variant="body2"> Waste per stop: </Typography>
                <TextField
                  id="weight-per-stop"
                  label={'Weight'}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">kg</InputAdornment>
                      ),
                    },
                  }}
                  onChange={(e) => setWeightPerStop(parseFloat(e.target.value))}
                  defaultValue={weightPerStop} // https://www.umweltberatung.at/download/?id=abfallumrechnungstabelle-3044-umweltberatung.pdf
                  type="number"
                  //size={'small'}
                  sx={{ width: '120px' }}
                />
              </Box>
              <Box
                display={'flex'}
                justifyContent={'space-between'}
                alignItems={'center'}
                width={'100%'}
              >
                <Typography variant="body2">
                  {' '}
                  CO<sub>2</sub>e for disposed:{' '}
                </Typography>
                <TextField
                  id="co2e-per-disposed"
                  label={'Emissions'}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">g/kg</InputAdornment>
                      ),
                    },
                  }}
                  onChange={(e) => setco2ePerKg(parseFloat(e.target.value))}
                  defaultValue={co2ePerKg} // https://www.sciencedirect.com/science/article/pii/S0956053X05000280 50% food waste, 50% yard waste assumed
                  type="number"
                  //size={'small'}
                  sx={{ width: '120px' }}
                />
              </Box>
              <Box
                display={'flex'}
                justifyContent={'space-between'}
                alignItems={'center'}
                width={'100%'}
              >
                <Typography variant="body2">
                  {' '}
                  CO<sub>2</sub>e per km:{' '}
                </Typography>
                <TextField
                  id="co2e-per-km"
                  label={'Emissions'}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">g/km</InputAdornment>
                      ),
                    },
                  }}
                  onChange={(e) => setco2ePerKm(parseFloat(e.target.value))}
                  defaultValue={co2ePerKm} // https://www.sciencedirect.com/science/article/pii/S0956053X05000280 50% food waste, 50% yard waste assumed
                  type="number"
                  //size={'small'}
                  sx={{ width: '120px' }}
                />
              </Box>
            </AccordionDetails>
          </Accordion>
          {routes.length > 0 && (
            <Box
              sx={{
                mt: '10px',
                width: '100%',
                borderTop: '5px solid ' + grey[500],
              }}
              py={2}
            >
              <Typography variant="h6"> Day details </Typography>
              <Typography variant="body1" align="left">
                {'total distance: ' +
                  Math.round(
                    routes
                      .map((route) => route.routeInfo.routeLength)
                      .reduce((a, b) => a + b, 0) / 1000,
                  ) +
                  'km'}
                <br />
                {'clean volume: ' +
                  routes
                    .map((route) =>
                      route.routeInfo.routeType === 'clean'
                        ? route.routeInfo.stops
                        : 0,
                    )
                    .reduce((a, b) => a + b, 0) +
                  ' bins'}
              </Typography>
              <RouteCheckboxList
                routeInfos={routes.map((route) => route.routeInfo)}
                colors={colors}
                onSelect={setIsRouteVisible}
              ></RouteCheckboxList>
            </Box>
          )}
        </Box>
      </Drawer>

      <MapContainer
        center={[
          47.982172843227616 + offset[0],
          18.185882089383355 + offset[1],
        ]}
        zoom={11}
        scrollWheelZoom={false}
        style={{ height: '100%' }}
      >
        {routes.map(
          (route, index) =>
            isRouteVisible.includes(route.routeInfo.routeId) && (
              <Polyline positions={route.routeCoords} color={colors[index]}>
                <Popup>
                  <Typography variant="h4" align="center">
                    Route {index + 1}
                  </Typography>
                  <Typography variant="h5" align="center">
                    Length: {route.routeInfo.routeLength}
                  </Typography>
                  <Typography variant="h5" align="center">
                    Type: {route.routeInfo.routeType}
                  </Typography>
                </Popup>
              </Polyline>
            ),
        )}

        {routes.map(
          (route) =>
            isRouteVisible.includes(route.routeInfo.routeId) && (
              <div key={route.routeInfo.routeId}>
                {route.routeCoords.map(
                  (node, idx) =>
                    node.score && (
                      <CircleMarker
                        center={[node.lat, node.lng]}
                        radius={5}
                        color={getPollutionColorGradient(
                          node.score === null ? -1 : node.score,
                        )}
                        opacity={1}
                        fillOpacity={1}
                        eventHandlers={{
                          click: async (e) => {
                            const res = await getPickUpById(node.id);
                            setAveragePickUpScore(
                              res
                                .map((x) => x.dscore)
                                .reduce((a, b) => a + b, 0) / res.length,
                            );
                            setIndividualDays(res);
                          },
                        }}
                      >
                        <StyledPopup>
                          <Typography variant="h6" align="center">
                            Pickup
                          </Typography>
                          <Typography
                            variant="body2"
                            align="left"
                            sx={{ marginBottom: 0 }}
                          >
                            id: {node.id} <br />
                            coords: {node.lat.toFixed(5)}, {node.lng.toFixed(5)}{' '}
                            <br />
                            {individualDays.length > 0 && (
                              <>
                                score:{' '}
                                {Math.round(averagePickUpScore * 1000) / 1000}{' '}
                                <br />
                                number of days: {individualDays.length}
                              </>
                            )}
                            {individualDays.length === 0 && (
                              <Typography variant={'subtitle1'}>
                                No past pollution data available
                              </Typography>
                            )}
                          </Typography>

                          {individualDays.length > 0 && (
                            <CircleDisplay
                              individualDays={individualDays}
                              handlePopoverClick={handlePopoverClick}
                              handlePopoverClose={handlePopoverClose}
                              openDayPopover={openDayPopover}
                            />
                          )}
                        </StyledPopup>
                      </CircleMarker>
                    ),
                )}
              </div>
            ),
        )}
        {staticMarkers && (
          <Marker
            icon={icon}
            position={staticMarkers.base}
            // color={'green'}
          >
            <Popup>
              <Typography variant="h5" align="center">
                Base
              </Typography>
              <Typography variant="body2" align="center">
                {staticMarkers.base[0].toFixed(5)},{' '}
                {staticMarkers.base[1].toFixed(5)}
              </Typography>
            </Popup>
          </Marker>
        )}
        {staticMarkers && (
          <Marker icon={icon} position={staticMarkers.dropOff}>
            <Popup>
              <Typography variant="h5" align="center">
                DropOff
              </Typography>
              <Typography variant="body2" align="center">
                {staticMarkers.dropOff[0].toFixed(5)},{' '}
                {staticMarkers.dropOff[1].toFixed(5)}
              </Typography>
            </Popup>
          </Marker>
        )}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <SetViewOnClick
          isTransposed={!toggleVienna}
          coords={[
            47.982172843227616 + offset[0],
            18.185882089383355 + offset[1],
          ]}
        />

        <ScaleControl position="bottomleft" />
      </MapContainer>
    </Box>
  );
}
