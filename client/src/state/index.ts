/**
 * State management exports
 */

export {
  // Types
  type MoodType,
  type WeatherPreference,
  type TemperatureComfort,
  type ActivityState,
  type PhysicalStats,
  type EmotionalStats,
  type SocialStats,
  type EnvironmentAwareness,
  type RecentExperience,
  type PersonalityTraits,
  type FrugState,

  // Constants
  DEFAULT_FRUG_STATE,

  // Helper functions
  getMoodEmoji,
  getMoodDisplayName,
  getMoodColor,
  calculateMood,
  getStatColor,
  getStatIcon,

  // State manager
  FrugStateManager,
  getFrugStateManager,
  resetFrugStateManager,
} from './FrugState';
