Pod::Spec.new do |s|
  s.name           = 'PinnedFetch'
  s.version        = '1.0.0'
  s.summary        = 'HTTPS to the paired Mac, trusted by its certificate fingerprint'
  s.author         = 'Autopilot'
  s.homepage       = 'https://github.com/eddial/autopilot-for-claude'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
end
