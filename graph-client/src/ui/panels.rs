//! egui panels for graph UI

use crate::graph::{GraphStore, GraphNode, RelationshipType};
use crate::input::GraphInteraction;

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

    /// Dialogue state
    pub dialogue_active: bool,
    dialogue_npc_id: Option<u64>,
    dialogue_input: String,
    dialogue_history: Vec<(bool, String)>, // (is_player, text)
}

impl GraphUI {
    pub fn new() -> Self {
        Self {
            filters: FilterState::default(),
            layout_strength: 0.5,
            show_filters_panel: true,
            show_details_panel: true,
            dialogue_active: false,
            dialogue_npc_id: None,
            dialogue_input: String::new(),
            dialogue_history: Vec::new(),
        }
    }

    /// Render the UI
    pub fn render(
        &mut self,
        ctx: &egui::Context,
        store: &GraphStore,
        interaction: &GraphInteraction,
    ) {
        // Top bar with stats
        egui::TopBottomPanel::top("top_bar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.label(format!("Nodes: {}", store.node_count));
                ui.separator();
                ui.label(format!("Edges: {}", store.edge_count));
                ui.separator();

                if ui.button("Filters").clicked() {
                    self.show_filters_panel = !self.show_filters_panel;
                }

                if ui.button("Details").clicked() {
                    self.show_details_panel = !self.show_details_panel;
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label("Frugworld Graph View");
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
                    egui::show_tooltip(
                        ctx,
                        egui::LayerId::new(egui::Order::Tooltip, egui::Id::new("tooltip_layer")),
                        egui::Id::new("node_tooltip"),
                        &egui::AbsoluteRect::NOTHING,
                        |ui: &mut egui::Ui| {
                            ui.label(&node.name);
                            ui.label(format!("LOD: {}", node.lod_state));
                        },
                    );
                }
            }
        }
    }

    fn render_filters_panel(&mut self, ui: &mut egui::Ui) {
        ui.heading("Relationship Filters");
        ui.separator();

        ui.checkbox(&mut self.filters.show_friends, "Friends");
        ui.checkbox(&mut self.filters.show_rivals, "Rivals");
        ui.checkbox(&mut self.filters.show_acquaintances, "Acquaintances");
        ui.checkbox(&mut self.filters.show_strangers, "Strangers");

        ui.separator();
        ui.heading("Layout");

        ui.horizontal(|ui| {
            ui.label("Strength:");
            ui.add(egui::Slider::new(&mut self.layout_strength, 0.0..=1.0));
        });

        if ui.button("Reset Layout").clicked() {
            // Will be handled by app
        }

        ui.separator();
        ui.heading("Keyboard Shortcuts");
        ui.label("WASD - Pan");
        ui.label("Scroll - Zoom");
        ui.label("Click - Select");
        ui.label("Shift+Click - Multi-select");
        ui.label("Space - Toggle layout");
        ui.label("F - Fit to view");
        ui.label("R - Reset layout");
        ui.label("Tab - Cycle neighbors");
        ui.label("Esc - Clear selection");
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
        ui.label(format!("LOD: {}", node.lod_state));
        ui.label(format!("Chunk: ({}, {})", node.chunk_x, node.chunk_y));

        ui.separator();
        ui.heading("Personality");

        ui.horizontal(|ui| {
            ui.label("Extraversion:");
            ui.add(egui::ProgressBar::new(node.extraversion as f32 / 100.0));
        });

        ui.horizontal(|ui| {
            ui.label("Agreeableness:");
            ui.add(egui::ProgressBar::new(node.agreeableness as f32 / 100.0));
        });

        ui.label(format!("Life Stage: {:?}", node.life_stage));
        ui.label(format!("Social Rep: {:+}", node.social_rep));

        // Activity section
        if !node.short_intent.is_empty() || !node.mid_goal.is_empty() || !node.long_goal.is_empty() {
            ui.separator();
            ui.heading("Current Activity");

            if !node.short_intent.is_empty() {
                ui.horizontal(|ui| {
                    ui.strong("Doing:");
                    ui.label(&node.short_intent);
                });
            }

            if !node.mid_goal.is_empty() {
                ui.horizontal(|ui| {
                    ui.strong("Goal:");
                    ui.label(&node.mid_goal);
                });
            }

            if !node.long_goal.is_empty() {
                ui.horizontal(|ui| {
                    ui.strong("Aspiration:");
                    ui.label(&node.long_goal);
                });
            }
        }

        // Needs section
        if !node.needs_summary.is_empty() {
            ui.separator();
            ui.heading("Needs");
            ui.label(&node.needs_summary);
        }

        // Memory section
        if !node.memory_summary.is_empty() {
            ui.separator();
            ui.heading("Recent Activity");
            egui::ScrollArea::vertical()
                .id_salt("memory_scroll")
                .max_height(80.0)
                .show(ui, |ui| {
                    ui.label(&node.memory_summary);
                });
        }

        ui.separator();
        ui.heading("Relationships");

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
                            let type_str = match edge.relationship_type {
                                RelationshipType::Stranger => "?",
                                RelationshipType::Acquaintance => "~",
                                RelationshipType::Friend => "+",
                                RelationshipType::CloseFriend => "++",
                                RelationshipType::Rival => "-",
                                RelationshipType::Enemy => "--",
                                RelationshipType::MentorStudent => "*",
                            };

                            ui.label(format!("[{}] {}", type_str, other.name));
                        });
                    }
                }
            });

        ui.separator();

        if ui.button("Start Dialogue").clicked() {
            self.start_dialogue(node.entity_id);
        }
    }

    fn render_dialogue_panel(&mut self, ui: &mut egui::Ui, store: &GraphStore) {
        ui.horizontal(|ui| {
            if let Some(npc_id) = self.dialogue_npc_id {
                if let Some(node) = store.nodes.get(&npc_id) {
                    ui.heading(format!("Talking to: {}", node.name));
                }
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Close").clicked() {
                    self.end_dialogue();
                }
            });
        });

        ui.separator();

        // Chat history
        egui::ScrollArea::vertical()
            .max_height(120.0)
            .stick_to_bottom(true)
            .show(ui, |ui| {
                for (is_player, text) in &self.dialogue_history {
                    if *is_player {
                        ui.horizontal(|ui| {
                            ui.label("You:");
                            ui.label(text);
                        });
                    } else {
                        ui.horizontal(|ui| {
                            ui.label("NPC:");
                            ui.label(text);
                        });
                    }
                }
            });

        ui.separator();

        // Input
        ui.horizontal(|ui| {
            let response = ui.add(
                egui::TextEdit::singleline(&mut self.dialogue_input)
                    .hint_text("Type a message...")
                    .desired_width(ui.available_width() - 60.0),
            );

            if ui.button("Send").clicked() || (response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter))) {
                if !self.dialogue_input.trim().is_empty() {
                    let message = std::mem::take(&mut self.dialogue_input);
                    self.dialogue_history.push((true, message.clone()));

                    // TODO: Send to server via reducer
                    // For now, add a mock response
                    self.dialogue_history.push((false, "I hear you, traveler.".to_string()));
                }
            }
        });
    }

    pub fn start_dialogue(&mut self, npc_id: u64) {
        self.dialogue_active = true;
        self.dialogue_npc_id = Some(npc_id);
        self.dialogue_input.clear();
        self.dialogue_history.clear();
        self.dialogue_history.push((false, "Hello, traveler. What brings you here?".to_string()));
    }

    pub fn end_dialogue(&mut self) {
        self.dialogue_active = false;
        self.dialogue_npc_id = None;
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
