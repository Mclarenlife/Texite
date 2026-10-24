require 'xcodeproj'
project = Xcodeproj::Project.open('apps/ios/App/App.xcodeproj')
app = project.targets.find { |t| t.name == 'App' }
target = project.targets.find { |t| t.name == 'TexiteUITests' } || project.new_target(:ui_test_bundle, 'TexiteUITests', :ios, '17.4')
target.add_dependency(app) unless target.dependencies.any?
group = project.main_group.find_subpath('TexiteUITests', true)
ref = group.files.find { |f| f.path == '../UITests/TexiteUITests.swift' } || group.new_file('../UITests/TexiteUITests.swift')
target.source_build_phase.add_file_reference(ref, true)
target.build_configurations.each do |c|
  c.build_settings.merge!({ 'PRODUCT_BUNDLE_IDENTIFIER' => 'com.texite.ios.uitests', 'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'YES', 'TEST_TARGET_NAME' => 'App', 'CODE_SIGNING_ALLOWED' => 'NO', 'TARGETED_DEVICE_FAMILY' => '1,2' })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(target)
scheme.set_launch_target(app)
scheme.save_as(project.path, 'App', true)
