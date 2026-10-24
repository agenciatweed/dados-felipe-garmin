"""Recursos habilitados; HRV excluido por solicitacao do usuario."""
RESOURCES = [
    ('activities', 'Atividades', 'Treinos', '/activitylist-service/activities/search/activities', 'activities'),
    ('activity', 'Detalhes da atividade', 'Treinos', '/activity-service/activity/{activityId}', 'activity'),
    ('workouts', 'Treinos associados', 'Treinos', '/activity-service/activity/{activityId}/workouts', 'activity'),
    ('download', 'Arquivo original da atividade', 'Treinos', '/download-service/files/activity/{activityId}', 'download'),
    ('zones', 'Zonas de frequência cardíaca', 'Treinos', '/biometric-service/heartRateZones/v2', 'static'),
    ('sleep', 'Sono do dia', 'Recuperação', '/sleep-service/sleep/dailySleep', 'day'),
    ('sleep_range', 'Histórico de sono', 'Recuperação', '/sleep-service/sleep/dailySleepSummariesByDate', 'range'),
    ('body_battery', 'Body Battery', 'Recuperação', '/wellness-service/wellness/bodyBattery/reports/daily', 'range'),
    ('stress', 'Estresse', 'Recuperação', '/usersummary-service/stats/stress/daily/{startDate}/{endDate}', 'range'),
    ('heart_rate', 'Frequência cardíaca do dia', 'Saúde', '/wellness-service/wellness/dailyHeartRate', 'day'),
    ('steps', 'Passos e distância diária', 'Saúde', '/usersummary-service/stats/steps/daily/{startDate}/{endDate}', 'range'),
    ('daily', 'Resumo completo do dia', 'Saúde', '/usersummary-service/usersummary/daily', 'day'),
    ('daily_range', 'Histórico de resumos diários', 'Saúde', '/usersummary-service/v2/dailysummaries', 'range'),
    ('profile', 'Perfil e configurações', 'Perfil', '/userprofile-service/userprofile/settings', 'static'),
]
CATALOG = {r[0]: dict(zip(('id', 'label', 'group', 'path', 'scope'), r)) for r in RESOURCES}
