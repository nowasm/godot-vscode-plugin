extends Node

var native_node: Node
var custom_node: CustomNode
var dynamic_target: Variant


func _ready() -> void:
	range(3)
	native_node.add_child(Node.new())
	move_player()
	custom_node.add_child("project collision")
	TestManager.change_phase()
	dynamic_target.call_it()
	print("project function wins over the utility function with the same name")


func move_player() -> void:
	pass


func print(message: String) -> void:
	var ignored := message
