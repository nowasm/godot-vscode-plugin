extends Control

func resize_control(other: Control) -> void:
	size = other.size
	var size_local := size
	unknown.size = size_local
