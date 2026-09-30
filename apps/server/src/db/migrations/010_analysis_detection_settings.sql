ALTER TABLE subscription_analysis_settings
ADD COLUMN llm_prompt TEXT NOT NULL DEFAULT '';

ALTER TABLE subscription_analysis_settings
ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'balanced'
CHECK (sensitivity IN ('low', 'balanced', 'high'));

ALTER TABLE subscription_analysis_settings
ADD COLUMN edge_focus_minutes INTEGER NOT NULL DEFAULT 5
CHECK (edge_focus_minutes BETWEEN 0 AND 15);
