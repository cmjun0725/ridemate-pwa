import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { ClimbSegment, Coordinate, ElevationPoint, LiveLocation, Ride, RouteCandidate, Stop } from "./types";

export async function requestCourseCandidates(input: {
  start: Coordinate;
  startName: string;
  distanceKm: number;
  uphill: "low" | "medium" | "high";
  tripType: "round" | "oneway";
}) {
  if (!functions) throw new Error("Firebase 연결 설정이 필요합니다.");
  const call = httpsCallable<typeof input, { candidates: RouteCandidate[] }>(
    functions,
    "recommendCourses",
  );
  return (await call(input)).data.candidates;
}

export const requestManualRoute = (start: Coordinate, end: Coordinate) =>
  callable<
    { start: Coordinate; end: Coordinate },
    {
      coordinates: Coordinate[];
      distanceKm: number;
      elevationM: number;
      elevationProfile: Array<{ distanceKm: number; elevationM: number }>;
      climbSegments: ClimbSegment[];
    }
  >("recommendRoute", { start, end });

export type RidePlanInput = {
  title: string;
  purpose: "group" | "solo";
  startName: string;
  endName?: string;
  startsAt?: string;
  distanceKm: number;
  elevationM?: number;
  paceKmh?: number;
  capacity?: number;
  description?: string;
  coordinates?: Coordinate[];
  elevationProfile?: Array<{ distanceKm: number; elevationM: number }>;
  climbSegments?: ClimbSegment[];
  stops?: Stop[];
};
export type StoredRidePlan = {
  id: string;
  title: string;
  purpose: "group" | "solo";
  status: string;
  hostId?: string;
  memberCount?: number;
  startsAt?: string;
  createdAt?: string;
  course: {
    startName?: string;
    endName?: string;
    distanceKm?: number;
    elevationM?: number;
    coordinates?: Coordinate[];
    elevationProfile?: ElevationPoint[];
    climbSegments?: ClimbSegment[];
    stops?: Stop[];
  };
  paceKmh?: number;
  capacity?: number;
  description?: string;
};
export type AdminDashboardData = {
  stats: { users: number; rides: number; openReports: number; noShows: number };
  users: Array<Record<string, unknown> & { id: string }>;
  rides: Array<Record<string, unknown> & { id: string }>;
  reports: Array<Record<string, unknown> & { id: string }>;
  logs: Array<Record<string, unknown> & { id: string }>;
};

async function callable<Input, Output>(name: string, input: Input) {
  if (!functions) throw new Error("Firebase 연결 설정이 필요합니다.");
  return (await httpsCallable<Input, Output>(functions, name)(input)).data;
}
export const createRidePlan = (input: RidePlanInput) =>
  callable<RidePlanInput, { id: string }>("createRidePlan", input);
export const repairRideCourse = (input: {
  rideId: string;
  coordinates: Coordinate[];
  distanceKm: number;
  elevationM: number;
  elevationProfile: ElevationPoint[];
  climbSegments: ClimbSegment[];
}) => callable<typeof input, { ok: boolean }>("repairRideCourse", input);
export const listMyRidePlans = () =>
  callable<Record<string, never>, { plans: StoredRidePlan[] }>(
    "listMyRidePlans",
    {},
  ).then((result) => result.plans);
export const removeRideFromMyList = (rideId: string) =>
  callable<{ rideId: string }, { ok: boolean }>("removeRideFromMyList", { rideId });
export const bootstrapAdmin = () =>
  callable<Record<string, never>, { ok: boolean }>("bootstrapAdmin", {});
export const getAdminDashboard = () =>
  callable<Record<string, never>, AdminDashboardData>("getAdminDashboard", {});
export const adminModerate = (input: {
  action: string;
  targetId: string;
  reason?: string;
}) => callable<typeof input, { ok: boolean }>("adminModerate", input);
export const listPublicRides = () =>
  callable<Record<string, never>, { rides: Ride[] }>(
    "listPublicRides",
    {},
  ).then((result) => result.rides);
export const getRideDetails = (rideId: string) =>
  callable<{ rideId: string }, { ride: Ride & { joined: boolean } }>(
    "getRideDetails",
    { rideId },
  ).then((result) => result.ride);
export const joinPublicRide = (rideId: string) =>
  callable<{ rideId: string }, { ok: boolean }>("joinRide", { rideId });
export const leavePublicRide = (rideId: string) =>
  callable<{ rideId: string }, { ok: boolean }>("leaveRide", { rideId });
export const startPublicRide = (rideId: string) =>
  callable<{ rideId: string }, { ok: boolean }>("startRide", { rideId });
export const finishPublicRide = (rideId: string) =>
  callable<{ rideId: string }, { ok: boolean }>("finishRide", { rideId });
export type RideMessage = {
  id: string;
  userId: string;
  authorName: string;
  text: string;
  createdAt?: string;
};
export const listRideMessages = (rideId: string) =>
  callable<{ rideId: string }, { messages: RideMessage[] }>(
    "listRideMessages",
    { rideId },
  ).then((result) => result.messages);
export const sendRideMessage = (rideId: string, text: string) =>
  callable<{ rideId: string; text: string }, { id: string }>(
    "sendRideMessage",
    { rideId, text },
  );
export type RiderSettings = {
  displayName: string;
  safety: {
    emergencyName?: string;
    emergencyPhone?: string;
    identityStatus?: string;
    phoneVerified?: boolean;
  };
  notifications: { ride: boolean; chat: boolean; safety: boolean };
  onboardingComplete: boolean;
  identityStatus: string;
};
export const getRiderSettings = () =>
  callable<Record<string, never>, { settings: RiderSettings }>(
    "getRiderSettings",
    {},
  ).then((result) => result.settings);
export const saveRiderSettings = (input: {
  displayName?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  notifyRide?: boolean;
  notifyChat?: boolean;
  notifySafety?: boolean;
  onboardingComplete?: boolean;
}) => callable<typeof input, { ok: boolean }>("saveRiderSettings", input);
export const registerDeviceToken = (token: string) =>
  callable<{ token: string }, { ok: boolean }>("registerDeviceToken", {
    token,
  });
export const reportUser = (input: {
  targetUserId: string;
  rideId?: string;
  category: "unsafe" | "harassment" | "no_show" | "other";
  details?: string;
}) => callable<typeof input, { ok: boolean }>("reportUser", input);
export const setUserBlocked = (targetUserId: string, blocked: boolean) =>
  callable<{ targetUserId: string; blocked: boolean }, { ok: boolean }>(
    "setUserBlocked",
    { targetUserId, blocked },
  );
export const setFavoriteRide = (rideId: string, favorite: boolean) =>
  callable<{ rideId: string; favorite: boolean }, { ok: boolean }>(
    "setFavoriteRide",
    { rideId, favorite },
  );
export const listFavoriteRides = () =>
  callable<Record<string, never>, { rideIds: string[] }>(
    "listFavoriteRides",
    {},
  ).then((result) => result.rideIds);
export const createRideReview = (input: {
  rideId: string;
  targetUserId: string;
  rating: number;
  comment?: string;
}) => callable<typeof input, { ok: boolean }>("createRideReview", input);
export const updateLiveLocation = (input: {
  rideId: string;
  lat?: number;
  lng?: number;
  active: boolean;
}) => callable<typeof input, { ok: boolean }>("updateLiveLocation", input);
export const listRideLiveLocations = (rideId: string) =>
  callable<{ rideId: string }, { locations: LiveLocation[] }>(
    "listRideLiveLocations",
    { rideId },
  ).then((result) => result.locations);
export const updateCourseStops = (rideId: string, selectedStopIds: string[]) =>
  callable<{ rideId: string; selectedStopIds: string[] }, { ok: boolean }>(
    "updateCourseStops",
    { rideId, selectedStopIds },
  );
export const getRideWeather = (coordinate: Coordinate) =>
  callable<
    Coordinate,
    {
      weather: {
        temperature_2m?: number;
        precipitation?: number;
        wind_speed_10m?: number;
      };
    }
  >("getRideWeather", coordinate).then((result) => result.weather);
export const trackProductEvent = (
  name:
    | "app_open"
    | "search"
    | "ride_view"
    | "ride_join"
    | "course_explore"
    | "course_created"
    | "install_prompt",
) => callable<{ name: string }, { ok: boolean }>("trackProductEvent", { name });
