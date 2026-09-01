export type PlaceKind = "편의점" | "화장실" | "정비소";
export type RideStatus = "계획" | "모집중" | "마감" | "진행중" | "완료";

export interface Coordinate {
  lat: number;
  lng: number;
}
export interface ElevationPoint {
  distanceKm: number;
  elevationM: number;
}
export interface ClimbSegment {
  id: string;
  startKm: number;
  endKm: number;
  gainM: number;
  avgGradient: number;
  coordinates: Coordinate[];
}
export interface Stop {
  id: string;
  name: string;
  kind: PlaceKind | "휴식";
  coordinate: Coordinate;
  selected?: boolean;
}
export interface Course {
  id: string;
  title: string;
  startName: string;
  endName: string;
  distanceKm: number;
  elevationM: number;
  coordinates: Coordinate[];
  elevationProfile?: ElevationPoint[];
  climbSegments?: ClimbSegment[];
  stops: Stop[];
  createdAt: string;
}
export interface Rider {
  id: string;
  name: string;
  avatar?: string;
  noShowCount: number;
}
export interface Ride {
  id: string;
  title: string;
  course: Course;
  startsAt: string;
  paceKmh: number;
  capacity: number;
  memberCount?: number;
  hostId?: string;
  host: Rider;
  members?: Rider[];
  status: RideStatus;
  meetingNote?: string;
  description?: string;
  joined?: boolean;
}
export interface RouteCandidate {
  id: string;
  title: string;
  summary: string;
  startName?: string;
  recommended?: boolean;
  waterwayName?: string;
  distanceKm: number;
  elevationM: number;
  climbRate: number;
  distanceDifferenceKm: number;
  coordinates: Coordinate[];
  elevationProfile: ElevationPoint[];
  climbSegments: ClimbSegment[];
  score?: number;
  verified: boolean;
}
