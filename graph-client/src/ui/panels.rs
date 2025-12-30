//! egui panels for graph UI

use crate::audio::AudioState;
use crate::graph::{GraphNode, GraphStore, RelationshipType};
use crate::input::{GraphInteraction, ProjectionMode};

/// UI filter state
#[derive(Debug, Clone)]
pub struct FilterState {
    pub show_friends: bool,
    pub show_rivals: bool,
    pub show_strangers: bool,
    pub show_acquaintances: bool,
}

impl Default for FilterState {
    fn default() -> Self {
        Self {
            show_friends: true,
            show_rivals: true,
            show_strangers: false,
            show_acquaintances: true,
        }
    }
}

/// Audio settings state for UI
#[derive(Debug, Clone)]
pub struct AudioSettings {
    pub master_volume: f32,
    pub music_volume: f32,
    pub ambient_volume: f32,
    pub dialogue_volume: f32,
    pub music_muted: bool,
    pub ambient_muted: bool,
    pub dialogue_enabled: bool,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            master_volume: 1.0,
            music_volume: 0.6,
            ambient_volume: 0.5,
            dialogue_volume: 1.0,
            music_muted: false,
            ambient_muted: false,
            dialogue_enabled: true,
        }
    }
}

impl From<&AudioState> for AudioSettings {
    fn from(state: &AudioState) -> Self {
        Self {
            master_volume: state.master_volume,
            music_volume: state.music_volume,
            ambient_volume: state.ambient_volume,
            dialogue_volume: state.dialogue_volume,
            music_muted: state.music_muted,
            ambient_muted: state.ambient_muted,
            dialogue_enabled: state.dialogue_enabled,
        }
    }
}

/// Graph UI state and rendering
pub struct GraphUI {
    /// Filter state
    pub filters: FilterState,

    /// Layout simulation strength
    pub layout_strength: f32,

    /// Whether to show the left panel
    show_filters_panel: bool,

    /// Whether to show the details panel
    show_details_panel: bool,

    /// Whether to show the audio settings panel
    show_audio_panel: bool,

    /// Audio settings (synced with AudioManager)
    pub audio_settings: AudioSettings,

    /// Flag indicating audio settings changed this frame
    pub audio_settings_changed: bool,

    /// Whether audio has been enabled/initialized
    pub audio_enabled: bool,

    /// Flag indicating user requested to enable audio (clicked button)
    pub audio_enable_requested: bool,

    /// Current projection mode for 2.5D rendering
    pub projection_mode: ProjectionMode,

    /// Flag indicating projection mode changed this frame
    pub projection_mode_changed: bool,

    /// Dialogue state
    pub dialogue_active: bool,
    dialogue_npc_id: Option<u64>,
    dialogue_input: String,
    pub dialogue_history: Vec<(bool, String)>, // (is_player, text)

    /// Whether we're waiting for an NPC response from the AI server
    pub awaiting_response: bool,
}

impl GraphUI {
    pub fn new() -> Self {
        Self {
            filters: FilterState::default(),
            layout_strength: 0.5,
            show_filters_panel: true,
            show_details_panel: true,
            show_audio_panel: false,
            audio_settings: AudioSettings::default(),
            audio_settings_changed: false,
            audio_enabled: false,
            audio_enable_requested: false,
            projection_mode: ProjectionMode::default(),
            projection_mode_changed: false,
            dialogue_active: false,
            dialogue_npc_id: None,
            dialogue_input: String::new(),
            dialogue_history: Vec::new(),
            awaiting_response: false,
        }
    }

    /// Check if user requested to enable audio
    pub fn take_audio_enable_request(&mut self) -> bool {
        if self.audio_enable_requested {
            self.audio_enable_requested = false;
            true
        } else {
            false
        }
    }

    /// Mark audio as enabled
    pub fn set_audio_enabled(&mut self, enabled: bool) {
        self.audio_enabled = enabled;
    }

    /// Check if projection mode changed and get the new mode
    pub fn take_projection_mode_change(&mut self) -> Option<ProjectionMode> {
        if self.projection_mode_changed {
            self.projection_mode_changed = false;
            Some(self.projection_mode)
        } else {
            None
        }
    }

    /// Sync audio settings from AudioManager state
    pub fn sync_audio_settings(&mut self, state: &AudioState) {
        self.audio_settings = AudioSettings::from(state);
    }

    /// Check if audio settings changed and reset the flag
    pub fn take_audio_changes(&mut self) -> Option<AudioSettings> {
        if self.audio_settings_changed {
            self.audio_settings_changed = false;
            Some(self.audio_settings.clone())
        } else {
            None
        }
    }

    /// Render the UI
    pub fn render(
        &mut self,
        ctx: &egui::Context,
        store: &GraphStore,
        interaction: &GraphInteraction,
    ) {
        self.render_with_frug(ctx, store, interaction, None, 0.0);
    }

    /// Render the UI with frug position info
    pub fn render_with_frug(
        &mut self,
        ctx: &egui::Context,
        store: &GraphStore,
        interaction: &GraphInteraction,
        frug_info: Option<(glam::Vec2, (i32, i32))>, // (position, chunk)
        fps: f32,
    ) {
        // Top bar with stats
        egui::TopBottomPanel::top("top_bar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                // Frug position
                if let Some((pos, chunk)) = frug_info {
                    ui.label(egui::RichText::new("🐸").size(16.0));
                    ui.label(format!("({:.0}, {:.0})", pos.x, pos.y));
                    ui.separator();
                    ui.label(format!("📍 Chunk ({}, {})", chunk.0, chunk.1));
                    ui.separator();
                }

                ui.label(format!("👥 {}", store.node_count));
                ui.separator();
                ui.label(format!("🔗 {}", store.edge_count));
                ui.separator();

                let filter_label = if self.show_filters_panel { "🔍 Filters ✓" } else { "🔍 Filters" };
                if ui.button(filter_label).clicked() {
                    self.show_filters_panel = !self.show_filters_panel;
                }

                let details_label = if self.show_details_panel { "📋 Details ✓" } else { "📋 Details" };
                if ui.button(details_label).clicked() {
                    self.show_details_panel = !self.show_details_panel;
                }

                // Show "Enable Audio" button if audio not yet enabled
                if !self.audio_enabled {
                    let enable_btn = egui::Button::new(
                        egui::RichText::new("🎵 Enable Audio")
                            .color(egui::Color32::from_rgb(255, 200, 100))
                    );
                    if ui.add(enable_btn).clicked() {
                        self.audio_enable_requested = true;
                    }
                } else {
                    let audio_label = if self.show_audio_panel { "🔊 Audio ✓" } else { "🔊 Audio" };
                    if ui.button(audio_label).clicked() {
                        self.show_audio_panel = !self.show_audio_panel;
                    }
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    // FPS counter on the right
                    ui.label(egui::RichText::new(format!("⚡ {:.0} FPS", fps)).color(egui::Color32::from_rgb(180, 165, 145)));
                    ui.separator();
                });
            });
        });

        // Left panel: Filters
        if self.show_filters_panel {
            egui::SidePanel::left("filters_panel")
                .default_width(200.0)
                .show(ctx, |ui| {
                    self.render_filters_panel(ui);
                });
        }

        // Audio settings panel (collapsible window)
        if self.show_audio_panel {
            egui::Window::new("🔊 Audio Settings")
                .collapsible(true)
                .resizable(false)
                .default_width(280.0)
                .show(ctx, |ui| {
                    self.render_audio_panel(ui);
                });
        }

        // Right panel: Node details
        if self.show_details_panel {
            if let Some(node_id) = interaction.get_primary_selection() {
                egui::SidePanel::right("details_panel")
                    .default_width(280.0)
                    .show(ctx, |ui| {
                        self.render_details_panel(ui, store, node_id);
                    });
            }
        }

        // Bottom panel: Dialogue (when active)
        if self.dialogue_active {
            egui::TopBottomPanel::bottom("dialogue_panel")
                .min_height(200.0)
                .show(ctx, |ui| {
                    self.render_dialogue_panel(ui, store);
                });
        }

        // Tooltip for hovered node
        if let Some(node_id) = interaction.hovered_node {
            if !interaction.is_selected(node_id) {
                if let Some(node) = store.nodes.get(&node_id) {
                    let parent_layer = egui::LayerId::new(egui::Order::Tooltip, egui::Id::new("tooltip_layer"));
                    let parent_widget = egui::Id::new("node_tooltip").with(node_id);
                    egui::Tooltip::always_open(
                        ctx.clone(),
                        parent_layer,
                        parent_widget,
                        egui::PopupAnchor::Pointer,
                    )
                    .show(|ui: &mut egui::Ui| {
                        ui.label(&node.name);
                    });
                }
            }
        }
    }

    fn render_filters_panel(&mut self, ui: &mut egui::Ui) {
        ui.heading("🔍 Filters");
        ui.separator();

        ui.checkbox(&mut self.filters.show_friends, "💚 Friends");
        ui.checkbox(&mut self.filters.show_rivals, "⚔️ Rivals");
        ui.checkbox(&mut self.filters.show_acquaintances, "👋 Acquaintances");
        ui.checkbox(&mut self.filters.show_strangers, "❓ Strangers");

        ui.separator();
        ui.heading("📐 Layout");

        ui.horizontal(|ui| {
            ui.label("Strength:");
            ui.add(egui::Slider::new(&mut self.layout_strength, 0.0..=1.0));
        });

        if ui.button("🔄 Reset Layout").clicked() {
            // Will be handled by app
        }

        ui.separator();
        ui.heading("📷 View");

        ui.horizontal(|ui| {
            ui.label("Projection:");

            // Projection mode selector
            let current_mode = self.projection_mode;
            egui::ComboBox::from_id_salt("projection_mode")
                .selected_text(current_mode.display_name())
                .show_ui(ui, |ui| {
                    if ui.selectable_value(&mut self.projection_mode, ProjectionMode::Orthographic2D, "2D").clicked() {
                        self.projection_mode_changed = true;
                    }
                    if ui.selectable_value(&mut self.projection_mode, ProjectionMode::Isometric, "Isometric").clicked() {
                        self.projection_mode_changed = true;
                    }
                    if ui.selectable_value(&mut self.projection_mode, ProjectionMode::Perspective, "Perspective").clicked() {
                        self.projection_mode_changed = true;
                    }
                });
        });

        // Show a hint about the current mode
        let mode_hint = match self.projection_mode {
            ProjectionMode::Orthographic2D => "Classic 2D top-down view",
            ProjectionMode::Isometric => "Fixed 45-degree angle, no distortion",
            ProjectionMode::Perspective => "True 3D with depth perception",
        };
        ui.label(egui::RichText::new(mode_hint).small().weak());

        ui.separator();
        ui.heading("⌨️ Controls");
        ui.add_space(2.0);
        let shortcut_color = egui::Color32::from_rgb(180, 165, 145);
        ui.label(egui::RichText::new("WASD - Move Frug").color(shortcut_color));
        ui.label(egui::RichText::new("Scroll - Zoom").color(shortcut_color));
        ui.label(egui::RichText::new("Drag - Pan").color(shortcut_color));
        ui.label(egui::RichText::new("Click - Select").color(shortcut_color));
        ui.label(egui::RichText::new("Shift+Click - Multi-select").color(shortcut_color));
        ui.label(egui::RichText::new("Space - Toggle layout").color(shortcut_color));
        ui.label(egui::RichText::new("F - Fit to view").color(shortcut_color));
        ui.label(egui::RichText::new("R - Reset layout").color(shortcut_color));
        ui.label(egui::RichText::new("Tab - Cycle neighbors").color(shortcut_color));
        ui.label(egui::RichText::new("Esc - Clear selection").color(shortcut_color));
        ui.label(egui::RichText::new("V - Cycle view mode").color(shortcut_color));
    }

    fn render_audio_panel(&mut self, ui: &mut egui::Ui) {
        let slider_color = egui::Color32::from_rgb(100, 180, 220);

        // Master Volume
        ui.heading("🔊 Master");
        ui.horizontal(|ui| {
            ui.label("Volume:");
            let mut master = (self.audio_settings.master_volume * 100.0) as i32;
            if ui.add(egui::Slider::new(&mut master, 0..=100).suffix("%").text_color(slider_color)).changed() {
                self.audio_settings.master_volume = master as f32 / 100.0;
                self.audio_settings_changed = true;
            }
        });

        ui.separator();

        // Music Controls
        ui.heading("🎵 Music");
        ui.horizontal(|ui| {
            ui.label("Volume:");
            let mut music = (self.audio_settings.music_volume * 100.0) as i32;
            let enabled = !self.audio_settings.music_muted;
            ui.add_enabled_ui(enabled, |ui| {
                if ui.add(egui::Slider::new(&mut music, 0..=100).suffix("%")).changed() {
                    self.audio_settings.music_volume = music as f32 / 100.0;
                    self.audio_settings_changed = true;
                }
            });
        });
        ui.horizontal(|ui| {
            if ui.checkbox(&mut self.audio_settings.music_muted, "Mute Music").changed() {
                self.audio_settings_changed = true;
            }
        });

        ui.separator();

        // Ambient Controls
        ui.heading("🌲 Ambient");
        ui.horizontal(|ui| {
            ui.label("Volume:");
            let mut ambient = (self.audio_settings.ambient_volume * 100.0) as i32;
            let enabled = !self.audio_settings.ambient_muted;
            ui.add_enabled_ui(enabled, |ui| {
                if ui.add(egui::Slider::new(&mut ambient, 0..=100).suffix("%")).changed() {
                    self.audio_settings.ambient_volume = ambient as f32 / 100.0;
                    self.audio_settings_changed = true;
                }
            });
        });
        ui.horizontal(|ui| {
            if ui.checkbox(&mut self.audio_settings.ambient_muted, "Mute Ambient").changed() {
                self.audio_settings_changed = true;
            }
        });

        ui.separator();

        // Dialogue Controls
        ui.heading("💬 Dialogue");
        ui.horizontal(|ui| {
            ui.label("Volume:");
            let mut dialogue = (self.audio_settings.dialogue_volume * 100.0) as i32;
            let enabled = self.audio_settings.dialogue_enabled;
            ui.add_enabled_ui(enabled, |ui| {
                if ui.add(egui::Slider::new(&mut dialogue, 0..=100).suffix("%")).changed() {
                    self.audio_settings.dialogue_volume = dialogue as f32 / 100.0;
                    self.audio_settings_changed = true;
                }
            });
        });
        ui.horizontal(|ui| {
            if ui.checkbox(&mut self.audio_settings.dialogue_enabled, "Enable Dialogue Audio").changed() {
                self.audio_settings_changed = true;
            }
        });

        ui.separator();

        // Reset button
        if ui.button("🔄 Reset to Defaults").clicked() {
            self.audio_settings = AudioSettings::default();
            self.audio_settings_changed = true;
        }
    }

    fn render_details_panel(&mut self, ui: &mut egui::Ui, store: &GraphStore, node_id: u64) {
        if let Some(node) = store.nodes.get(&node_id) {
            self.render_node_details(ui, store, node);
        }
    }

    fn render_node_details(&mut self, ui: &mut egui::Ui, store: &GraphStore, node: &GraphNode) {
        ui.heading(&node.name);
        ui.label(format!("ID: {}", node.entity_id));
        ui.label(format!("Archetype: {}", Self::archetype_name(node.archetype_id)));
        ui.label(format!("Chunk: ({}, {})", node.chunk_x, node.chunk_y));

        ui.separator();
        ui.heading("🎭 Personality");

        // Extraversion bar - warm orange/yellow
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new("🌟").size(14.0));
            ui.label("Extraversion:");
            let extraversion_pct = node.extraversion as f32 / 100.0;
            ui.add(
                egui::ProgressBar::new(extraversion_pct)
                    .fill(egui::Color32::from_rgb(230, 160, 60))
                    .text(format!("{}", node.extraversion))
            );
        });

        // Agreeableness bar - soft green/teal
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new("💚").size(14.0));
            ui.label("Agreeableness:");
            let agreeableness_pct = node.agreeableness as f32 / 100.0;
            ui.add(
                egui::ProgressBar::new(agreeableness_pct)
                    .fill(egui::Color32::from_rgb(80, 180, 120))
                    .text(format!("{}", node.agreeableness))
            );
        });

        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new("🌱").size(14.0));
            ui.label(format!("Life Stage: {:?}", node.life_stage));
        });
        ui.horizontal(|ui| {
            let rep_icon = if node.social_rep >= 0 { "⭐" } else { "💢" };
            let rep_color = if node.social_rep >= 0 {
                egui::Color32::from_rgb(240, 200, 80)
            } else {
                egui::Color32::from_rgb(200, 100, 80)
            };
            ui.label(egui::RichText::new(rep_icon).size(14.0));
            ui.label("Social Rep:");
            ui.label(egui::RichText::new(format!("{:+}", node.social_rep)).color(rep_color));
        });

        // Activity section
        if !node.short_intent.is_empty() || !node.mid_goal.is_empty() || !node.long_goal.is_empty() {
            ui.separator();
            ui.heading("🎯 Current Activity");

            if !node.short_intent.is_empty() {
                ui.horizontal(|ui| {
                    ui.label("⚡");
                    ui.strong("Doing:");
                    ui.label(&node.short_intent);
                });
            }

            if !node.mid_goal.is_empty() {
                ui.horizontal(|ui| {
                    ui.label("🎯");
                    ui.strong("Goal:");
                    ui.label(&node.mid_goal);
                });
            }

            if !node.long_goal.is_empty() {
                ui.horizontal(|ui| {
                    ui.label("🌠");
                    ui.strong("Aspiration:");
                    ui.label(&node.long_goal);
                });
            }
        }

        // Needs section
        if !node.needs_summary.is_empty() {
            ui.separator();
            ui.heading("💭 Needs");
            ui.label(&node.needs_summary);
        }

        // Memory section
        if !node.memory_summary.is_empty() {
            ui.separator();
            ui.heading("📜 Recent Activity");
            egui::ScrollArea::vertical()
                .id_salt("memory_scroll")
                .max_height(80.0)
                .show(ui, |ui| {
                    ui.label(&node.memory_summary);
                });
        }

        ui.separator();
        ui.heading("🤝 Relationships");

        let edges = store.get_node_edges(node.entity_id);
        ui.label(format!("{} connections", edges.len()));

        egui::ScrollArea::vertical()
            .max_height(200.0)
            .show(ui, |ui| {
                for edge in edges.iter().take(20) {
                    let other_id = if edge.source_id == node.entity_id {
                        edge.target_id
                    } else {
                        edge.source_id
                    };

                    if let Some(other) = store.nodes.get(&other_id) {
                        ui.horizontal(|ui| {
                            let (icon, color) = match edge.relationship_type {
                                RelationshipType::Stranger => ("❓", egui::Color32::from_rgb(150, 150, 150)),
                                RelationshipType::Acquaintance => ("👋", egui::Color32::from_rgb(180, 160, 120)),
                                RelationshipType::Friend => ("💚", egui::Color32::from_rgb(100, 200, 120)),
                                RelationshipType::CloseFriend => ("💛", egui::Color32::from_rgb(240, 200, 80)),
                                RelationshipType::Rival => ("⚔️", egui::Color32::from_rgb(220, 120, 80)),
                                RelationshipType::Enemy => ("💔", egui::Color32::from_rgb(200, 80, 80)),
                                RelationshipType::MentorStudent => ("📚", egui::Color32::from_rgb(140, 180, 220)),
                            };

                            ui.label(egui::RichText::new(icon));
                            ui.label(egui::RichText::new(&other.name).color(color));
                        });
                    }
                }
            });

        ui.separator();

        if ui.button("💬 Start Dialogue").clicked() {
            self.start_dialogue(node.entity_id);
        }
    }

    fn render_dialogue_panel(&mut self, ui: &mut egui::Ui, store: &GraphStore) {
        ui.horizontal(|ui| {
            if let Some(npc_id) = self.dialogue_npc_id {
                if let Some(node) = store.nodes.get(&npc_id) {
                    ui.heading(format!("💬 Talking to: {}", node.name));
                }
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("❌ Close").clicked() {
                    self.end_dialogue();
                }
            });
        });

        ui.separator();

        // Chat history
        let player_color = egui::Color32::from_rgb(140, 200, 240);
        let npc_color = egui::Color32::from_rgb(240, 200, 140);
        egui::ScrollArea::vertical()
            .max_height(120.0)
            .stick_to_bottom(true)
            .show(ui, |ui| {
                for (is_player, text) in &self.dialogue_history {
                    if *is_player {
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new("🧑 You:").color(player_color));
                            ui.label(text);
                        });
                    } else {
                        ui.horizontal(|ui| {
                            ui.label(egui::RichText::new("🗣️ NPC:").color(npc_color));
                            ui.label(text);
                        });
                    }
                }
            });

        ui.separator();

        // Show loading indicator when awaiting NPC response
        if self.awaiting_response {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label(egui::RichText::new("💭 NPC is thinking...").italics());
            });
        }

        // Input (disabled while awaiting response)
        ui.horizontal(|ui| {
            ui.add_enabled_ui(!self.awaiting_response, |ui| {
                let response = ui.add(
                    egui::TextEdit::singleline(&mut self.dialogue_input)
                        .hint_text("✏️ Type a message...")
                        .desired_width(ui.available_width() - 70.0),
                );

                if ui.button("📤 Send").clicked() || (response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter))) {
                    if !self.dialogue_input.trim().is_empty() {
                        let message = std::mem::take(&mut self.dialogue_input);
                        self.dialogue_history.push((true, message.clone()));

                        // Send to server via JS bridge
                        if crate::connection::spacetime::bridge_is_connected() {
                            if let Err(e) = crate::connection::spacetime::dialogue_say(&message) {
                                log::error!("Failed to send dialogue: {}", e);
                                self.dialogue_history.push((false, "[Error sending message]".to_string()));
                            } else {
                                self.awaiting_response = true;
                            }
                        } else {
                            // Fallback for when bridge isn't connected (local testing)
                            log::warn!("Bridge not connected, using mock response");
                            self.dialogue_history.push((false, "I hear you, traveler. (offline mode)".to_string()));
                        }
                    }
                }
            });
        });
    }

    pub fn start_dialogue(&mut self, npc_id: u64) {
        self.dialogue_active = true;
        self.dialogue_npc_id = Some(npc_id);
        self.dialogue_input.clear();
        self.dialogue_history.clear();
        self.awaiting_response = false;

        // Call the server to start dialogue
        if crate::connection::spacetime::bridge_is_connected() {
            if let Err(e) = crate::connection::spacetime::start_dialogue(npc_id) {
                log::error!("Failed to start dialogue: {}", e);
                self.dialogue_history.push((false, "[Error starting dialogue]".to_string()));
            } else {
                // Wait for the server to send the NPC's greeting
                self.awaiting_response = true;
            }
        } else {
            // Fallback greeting for offline mode
            self.dialogue_history.push((false, "Hello, traveler. What brings you here? (offline mode)".to_string()));
        }
    }

    pub fn end_dialogue(&mut self) {
        // Notify server that dialogue ended
        if crate::connection::spacetime::bridge_is_connected() {
            if let Err(e) = crate::connection::spacetime::end_dialogue() {
                log::warn!("Failed to end dialogue cleanly: {}", e);
            }
        }

        self.dialogue_active = false;
        self.dialogue_npc_id = None;
        self.awaiting_response = false;
    }

    fn archetype_name(id: u32) -> &'static str {
        match id {
            0 => "Villager",
            1 => "Farmer",
            2 => "Merchant",
            3 => "Guard",
            4 => "Healer",
            _ => "Unknown",
        }
    }

    // Toggle methods for keyboard shortcuts
    pub fn toggle_filter_friends(&mut self) {
        self.filters.show_friends = !self.filters.show_friends;
    }

    pub fn toggle_filter_rivals(&mut self) {
        self.filters.show_rivals = !self.filters.show_rivals;
    }

    pub fn toggle_filter_strangers(&mut self) {
        self.filters.show_strangers = !self.filters.show_strangers;
    }
}

impl Default for GraphUI {
    fn default() -> Self {
        Self::new()
    }
}
